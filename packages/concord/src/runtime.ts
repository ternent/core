import { encodeBase64Url, validatePublicIdentity } from "@ternent/identity";
import { caught, error, fail, ok, type Result, type ErrorCode, Fault } from "./common/errors.js";
import { detached, freeze } from "./common/immutable.js";
import { nonce } from "./common/random.js";
import { encodeJson, parseJson, text } from "./protocol/json.js";
import {
  inspectProtocol,
  identifier,
  signatureMessage,
  compareSnapshots,
} from "./protocol/verify.js";
import { limits as configureLimits, ref, snapshot as validateSnapshot } from "./protocol/schema.js";
import { issueHistory } from "./protocol/history.js";
import type {
  Json,
  DomainEvent,
  Snapshot,
  Limits,
  CommitSubject,
  EntrySubject,
} from "./protocol/types.js";
import type {
  ApplicationModel,
  DocumentHandle,
  HostOptions,
  InspectionReport,
  InspectionState,
  ReadyState,
  CommitReceipt,
  Capability,
  ModelIssue,
} from "./model/types.js";
import { systemAuthors } from "./system/authoring.js";
import type {
  SystemProfile,
  SystemReplay,
  ApplicationIntent,
  SystemIntent,
} from "./system/types.js";
import type { IdentityCapability } from "@ternent/armour";
type AnyModel = ApplicationModel<Json, Record<string, Json>, DomainEvent>;
type Options = HostOptions<Json, Record<string, Json>, DomainEvent> & { invalidHost?: true };
type Evaluation =
  | { inspection: InspectionReport; state: InspectionState }
  | {
      inspection: InspectionReport;
      state: ReadyState<Json>;
      snapshot: Snapshot;
      system: SystemReplay;
    };
const same = (a: unknown, b: unknown) => text.decode(encodeJson(a)) === text.decode(encodeJson(b));
const capabilities: Capability[] = ["read", "write", "grant", "administer"];
function checkRequirements(values: readonly Capability[]): void {
  if (
    !Array.isArray(values) ||
    new Set(values).size !== values.length ||
    !values.every((v) => capabilities.includes(v))
  )
    fail("MODEL_FAILED", "model");
}

function accepted<T>(result: Result<T, ModelIssue>, code: ErrorCode): T {
  if (!result || typeof result !== "object" || typeof result.ok !== "boolean")
    fail("MODEL_FAILED", "model");
  if (!result.ok) {
    const outer =
      code === "EVENT_INVALID" && result.error.code === "EVENT_UNSUPPORTED"
        ? "EVENT_UNSUPPORTED"
        : code;
    const finding = error(
      outer,
      outer.startsWith("COMMAND") ? "author" : "model",
      result.error.path,
    );
    finding.details = { modelCode: result.error.code };
    throw new Fault(finding);
  }
  return result.value;
}
function json<T>(
  value: T,
  lim: Limits,
  code: ErrorCode,
  phase: "model" | "author" | "system" = "model",
): T {
  try {
    return freeze(parseJson(encodeJson(value, lim.maxDepth), lim.maxDepth, lim.maxBytes)) as T;
  } catch (cause) {
    if (cause instanceof Fault && cause.finding.code === "RESOURCE_LIMIT") throw cause;
    fail(code, phase);
  }
}
function host(options: Options): void {
  if (options.invalidHost) fail("HOST_CONFIGURATION", "requirements");
  if (options.mode !== undefined && options.mode !== "immediate")
    fail("HOST_CONFIGURATION", "requirements");
  if (options.model) {
    const model = options.model;
    try {
      ref(model.ref, "");
    } catch {
      fail("HOST_CONFIGURATION", "requirements");
    }
    if (
      !model.commands ||
      typeof model.commands !== "object" ||
      ![
        model.initial,
        model.validateEvent,
        model.requirements,
        model.reduce,
        ...Object.values(model.commands).flatMap((c) => [c?.validate, c?.decide]),
      ].every((fn) => typeof fn === "function")
    )
      fail("HOST_CONFIGURATION", "requirements");
  }
  if (options.system) {
    try {
      ref(options.system.ref, "");
    } catch {
      fail("HOST_CONFIGURATION", "requirements");
    }
    if (
      ![options.system.bootstrap, options.system.replay, options.system.prepare].every(
        (fn) => typeof fn === "function",
      )
    )
      fail("HOST_CONFIGURATION", "requirements");
  }
  for (const capability of [options.signer, options.reader])
    if (
      capability &&
      (!validatePublicIdentity(capability.publicIdentity).ok ||
        typeof capability.decryptAge !== "function")
    )
      fail("HOST_CONFIGURATION", "requirements");
  if (options.signer && typeof options.signer.sign !== "function")
    fail("HOST_CONFIGURATION", "requirements");
  if (
    options.signer &&
    options.reader &&
    !same(options.signer.publicIdentity, options.reader.publicIdentity)
  )
    fail("IDENTITY_MISMATCH", "requirements");
}
function copyOptions(input: Options): Options {
  configureLimits(input.limits);
  const model = input.model;
  return {
    ...input,
    limits: input.limits ? { ...input.limits } : undefined,
    anchor: input.anchor ? new Uint8Array(input.anchor) : undefined,
    model: model
      ? {
          ...model,
          ref: detached(model.ref),
          commands: Object.fromEntries(
            Object.entries(model.commands ?? {}).map(([key, value]) => [key, { ...value }]),
          ),
        }
      : undefined,
    system: input.system ? { ...input.system, ref: detached(input.system.ref) } : undefined,
  };
}
function checkSystem(output: SystemReplay, wire: Snapshot, lim: Limits): SystemReplay {
  const application = wire.entries.filter((e) => e.subject.kind === "application");
  if (
    !output ||
    !output.session ||
    typeof output.session !== "object" ||
    !Array.isArray(output.entryFacts) ||
    !Array.isArray(output.events) ||
    !Array.isArray(output.members) ||
    !Array.isArray(output.epochs) ||
    output.entryFacts?.length !== wire.entries.length ||
    output.events?.length !== application.length
  )
    fail("SYSTEM_FAILED", "system");
  let index = 0;
  for (const commit of wire.commits)
    for (const entryId of commit.subject.entryIds) {
      const item = output.entryFacts[index++];
      if (item.entryId !== entryId || !same(item.facts.actor, commit.subject.signer))
        fail("SYSTEM_FAILED", "system");
    }
  const facts = new Map(output.entryFacts.map((item) => [item.entryId, item.facts]));
  for (let i = 0; i < application.length; i++)
    if (
      output.events[i].entryId !== application[i].id ||
      !same(output.events[i].facts, facts.get(application[i].id))
    )
      fail("SYSTEM_FAILED", "system");
  // Repeated facts expand with history; bound each value, not their aggregate encoding.
  const copy = <T>(value: T): T => json(value, lim, "SYSTEM_FAILED", "system");
  return freeze({
    entryFacts: output.entryFacts.map(copy),
    events: output.events.map(copy),
    members: copy(output.members),
    epochs: copy(output.epochs),
    reader: copy(output.reader),
    session: output.session,
  });
}
function fold(
  model: AnyModel,
  system: SystemReplay,
  lim: Limits,
  call: <T>(fn: () => T) => T,
): Json {
  let projection = json(
    call(() => model.initial()),
    lim,
    "MODEL_TRANSITION_INVALID",
  );
  for (const item of system.events) {
    const event = json(
      accepted(
        call(() => model.validateEvent(item.event)),
        "EVENT_INVALID",
      ),
      lim,
      "EVENT_INVALID",
    );
    const required = call(() => model.requirements(event));
    checkRequirements(required);
    if (
      !item.facts.capabilities.includes("write") ||
      !required.every((c) => item.facts.capabilities.includes(c))
    )
      fail("CAPABILITY_DENIED", "system");
    projection = json(
      accepted(
        call(() => model.reduce(projection, event, item.facts)),
        "MODEL_TRANSITION_INVALID",
      ),
      lim,
      "MODEL_TRANSITION_INVALID",
    );
  }
  return projection;
}
async function evaluate(
  bytes: Uint8Array,
  options: Options,
  call: <T>(fn: () => T) => T,
): Promise<Evaluation> {
  const protocol = await inspectProtocol(bytes, { limits: options.limits });
  const report: InspectionReport = {
    verification: protocol.report,
    system: "not-run",
    application: "not-run",
    otherRecipientsDecryptability: "unverified",
    freshness: "unanchored",
    requirements: [],
    lockedEntries: null,
    findings: [...protocol.report.findings],
    history: protocol.untrustedHistory,
  };
  const inspect = (reason: InspectionState["reason"]): Evaluation => ({
    inspection: detached(report),
    state: { status: "inspection", reason },
  });
  if (!protocol.snapshot)
    return inspect(protocol.report.integrity === "invalid" ? "invalid" : "incompatible");
  const wire = detached(protocol.snapshot),
    declaration = wire.commits[0].subject.declaration!;
  try {
    host(options);
  } catch (cause) {
    report.findings = [caught(cause, "HOST_CONFIGURATION", "requirements")];
    return inspect("incompatible");
  }
  const missing: InspectionReport["requirements"][number][] = [];
  if (!options.system || !same(options.system.ref, declaration.system))
    missing.push({ kind: "system", ref: declaration.system });
  if (!options.model || !same(options.model.ref, declaration.model))
    missing.push({ kind: "model", ref: declaration.model });
  if (missing.length) {
    report.requirements = missing;
    report.findings = [error("REQUIREMENT_UNAVAILABLE", "requirements")];
    return inspect("incompatible");
  }
  if (options.anchor) {
    const relation = await compareSnapshots(bytes, options.anchor, { limits: options.limits });
    if (!relation.ok) {
      report.findings = [error("ANCHOR_INVALID", "protocol")];
      return inspect("freshness");
    }
    report.freshness = relation.value;
    const code =
      relation.value === "behind"
        ? "STALE_HEAD"
        : relation.value === "diverged"
          ? "DIVERGED_HEAD"
          : relation.value === "unrelated"
            ? "DOCUMENT_MISMATCH"
            : null;
    if (code) {
      report.findings = [error(code, "protocol")];
      return inspect("freshness");
    }
  }
  const lim = configureLimits(options.limits);
  let system: SystemReplay;
  try {
    const result = await call(() =>
      options.system!.replay({
        history: issueHistory(wire),
        reader: options.reader ?? options.signer,
        limits: lim,
      }),
    );
    if (!result.ok) throw new Fault(result.error);
    system = checkSystem(result.value, wire, lim);
    report.system = "valid";
    if (
      (options.reader && !same(system.reader, options.reader.publicIdentity)) ||
      (!options.reader && options.signer && !same(system.reader, options.signer.publicIdentity))
    )
      fail("SYSTEM_FAILED", "system");
  } catch (cause) {
    const finding = caught(cause, "SYSTEM_FAILED", "system");
    report.findings = [finding];
    if (finding.code === "READ_ACCESS_REQUIRED" || finding.code === "KEY_UNAVAILABLE") {
      report.system = "valid";
      report.application = "locked";
      report.lockedEntries = Number(
        finding.details?.lockedEntries ??
          wire.entries.filter((e) => e.subject.kind === "application").length,
      );
      return inspect("locked");
    }
    report.system =
      finding.code === "UNSUPPORTED_SYSTEM_EVENT" || finding.code === "RESOURCE_LIMIT"
        ? "unsupported"
        : "invalid";
    return inspect(report.system === "unsupported" ? "incompatible" : "invalid");
  }
  try {
    const projection = fold(options.model!, system, lim, call);
    report.application = "valid";
    report.lockedEntries = 0;
    const signer = options.signer,
      member = system.members.find((m) => m.identity.id === signer?.publicIdentity.id);
    return {
      inspection: detached(report),
      snapshot: wire,
      system,
      state: freeze({
        status: "ready",
        documentId: wire.documentId,
        head: wire.head,
        projection,
        canWrite: Boolean(signer && member?.capabilities.includes("write")),
      }),
    };
  } catch (cause) {
    const finding = caught(cause, "MODEL_FAILED", "model");
    report.findings = [finding];
    report.application =
      finding.code === "EVENT_UNSUPPORTED" || finding.code === "RESOURCE_LIMIT"
        ? "unsupported"
        : "invalid";
    return inspect(report.application === "unsupported" ? "incompatible" : "invalid");
  }
}
async function candidate(
  base: Snapshot | null,
  subjects: readonly EntrySubject[],
  signer: IdentityCapability,
  options: Options,
  lim: Limits,
): Promise<Snapshot> {
  const entries = subjects.map((subject) => ({
    id: identifier(subject, "entry", lim.maxDepth),
    subject,
  }));
  const subject: CommitSubject = {
    version: 1,
    suite: "concord-25519-age-v1",
    parent: base?.head ?? null,
    nonce: nonce(),
    signer: { ...signer.publicIdentity },
    declaration: base ? null : { model: options.model!.ref, system: options.system!.ref },
    entryIds: entries.map((e) => e.id),
    metadata: null,
  };
  const id = identifier(subject, "commit", lim.maxDepth);
  const commit = { id, subject, signature: encodeBase64Url(new Uint8Array(64)) };
  const wire: Snapshot = {
    format: "concord",
    version: 1,
    documentId: base?.documentId ?? id,
    head: id,
    commits: [...(base?.commits ?? []), commit],
    entries: [...(base?.entries ?? []), ...entries],
    metadata: base?.metadata ?? null,
  };
  const size = encodeJson(wire, lim.maxDepth).length;
  if (size > lim.maxBytes) fail("RESOURCE_LIMIT");
  validateSnapshot(wire, lim);
  let signed: Awaited<ReturnType<IdentityCapability["sign"]>>;
  try {
    signed = await signer.sign(signatureMessage(subject, lim.maxDepth));
  } catch {
    fail("SIGNING_FAILED", "author");
  }
  if (!signed.ok || !(signed.value instanceof Uint8Array) || signed.value.length !== 64)
    fail("SIGNING_FAILED", "author");
  commit.signature = encodeBase64Url(signed.value);
  return wire;
}
function handle(
  initial: Evaluation,
  input: Uint8Array,
  options: Options,
): DocumentHandle<Json, Record<string, Json>> {
  let current = initial,
    callbacks = 0;
  let bytes: Uint8Array = new Uint8Array(input);
  let queue: Promise<unknown> = Promise.resolve();
  const call = <T>(fn: () => T): T => {
    callbacks++;
    try {
      return fn();
    } finally {
      callbacks--;
    }
  };
  const serialized = <T>(body: () => Promise<Result<T>> | Result<T>): Promise<Result<T>> => {
    if (callbacks)
      return Promise.resolve({ ok: false, error: error("HOST_CONFIGURATION", "requirements") });
    const pending = queue.then(async () => {
      try {
        return await body();
      } catch (cause) {
        return { ok: false as const, error: caught(cause, "MODEL_FAILED", "model") };
      }
    });
    queue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  };
  function authoring(): Extract<Evaluation, { snapshot: Snapshot }> {
    if (current.state.status !== "ready") fail("INSPECTION_ONLY", "author");
    if (!options.signer) fail("READ_ONLY_RUNTIME", "author");
    return current as Extract<Evaluation, { snapshot: Snapshot }>;
  }
  function writable(): Extract<Evaluation, { snapshot: Snapshot }> {
    const ready = authoring();
    if (!ready.state.canWrite) fail("CAPABILITY_DENIED", "system");
    return ready;
  }
  async function commitIntents(
    ready: Extract<Evaluation, { snapshot: Snapshot }>,
    intents: readonly (ApplicationIntent | SystemIntent)[],
    lim: Limits,
  ): Promise<Result<CommitReceipt>> {
    const signer = options.signer!;
    let prepared: Result<readonly EntrySubject[]>;
    try {
      prepared = await call(() =>
        options.system!.prepare({
          history: issueHistory(ready.snapshot),
          current: ready.system,
          signer,
          intents: freeze(intents),
          limits: lim,
        }),
      );
    } catch {
      fail("SYSTEM_FAILED", "system");
    }
    if (!prepared.ok) throw new Fault(prepared.error);
    if (
      prepared.value.length !== intents.length ||
      prepared.value.some((entry, index) => {
        const intent = intents[index];
        return intent.kind === "application"
          ? entry.kind !== "application"
          : entry.kind !== "system" || entry.payload.type !== `system.${intent.kind}`;
      })
    )
      fail("SYSTEM_FAILED", "system");
    const wire = await candidate(
      ready.snapshot,
      json(prepared.value, lim, "SYSTEM_FAILED"),
      signer,
      options,
      lim,
    );
    const nextBytes = encodeJson(wire, lim.maxDepth),
      next = await evaluate(nextBytes, options, call);
    if (next.state.status !== "ready") return { ok: false, error: next.inspection.findings[0] };
    current = next;
    bytes = nextBytes;
    return ok({
      status: "committed",
      head: wire.head,
      entryIds: wire.commits.at(-1)!.subject.entryIds,
    });
  }
  const document: DocumentHandle<Json, Record<string, Json>> = {
    state: () => detached(current.state),
    inspect: () => detached(current.inspection),
    export: () => new Uint8Array(bytes),
    verify: async () =>
      detached((await inspectProtocol(new Uint8Array(bytes), { limits: options.limits })).report),
    async replay() {
      if (current.state.status !== "ready")
        return {
          ok: false,
          error: current.inspection.findings[0] ?? error("INSPECTION_ONLY", "author"),
        };
      const result = await evaluate(new Uint8Array(bytes), options, call);
      return result.state.status === "ready"
        ? ok(detached(result.state.projection))
        : { ok: false, error: result.inspection.findings[0] };
    },
    dispatch(command, input) {
      let copied: Json | undefined, copyFailure: ReturnType<typeof caught> | undefined;
      try {
        copied = json(input, configureLimits(options.limits), "COMMAND_INVALID", "author");
      } catch (cause) {
        copyFailure = caught(cause, "COMMAND_INVALID", "author");
      }
      return serialized(async () => {
        const ready = writable(),
          model = options.model!,
          lim = configureLimits(options.limits);
        if (!Object.hasOwn(model.commands, command)) fail("COMMAND_UNSUPPORTED", "author");
        if (copyFailure) return { ok: false, error: copyFailure };
        const registration = model.commands[command];
        const actor = options.signer!.publicIdentity,
          member = ready.system.members.find((m) => m.identity.id === actor.id)!;
        const facts = detached({
          actor,
          capabilities: member.capabilities,
          members: ready.system.members,
        });
        const validated = json(
          accepted(
            call(() => registration.validate(copied)),
            "COMMAND_INVALID",
          ),
          lim,
          "COMMAND_INVALID",
          "author",
        );
        const events = accepted(
          call(() => registration.decide(validated, ready.state.projection, { facts })),
          "COMMAND_REJECTED",
        );
        if (!Array.isArray(events)) fail("MODEL_FAILED", "model");
        if (!events.length) fail("NO_EVENTS", "author");
        const intents: ApplicationIntent[] = events.map((input) => {
          const event = json(
            accepted(
              call(() => model.validateEvent(input)),
              "EVENT_INVALID",
            ),
            lim,
            "EVENT_INVALID",
          );
          const required = call(() => model.requirements(event));
          checkRequirements(required);
          if (!required.every((capability) => member.capabilities.includes(capability)))
            fail("CAPABILITY_DENIED", "system");
          return detached({
            kind: "application" as const,
            event,
            required,
            audience: "document" as const,
          });
        });
        return commitIntents(ready, intents, lim);
      });
    },
    commit: () =>
      serialized(() => {
        writable();
        return { ok: false, error: error("NO_DRAFT", "author") };
      }),
    discardDraft: () =>
      serialized(() => {
        writable();
        return ok(undefined);
      }),
    draft: () => null,
  };
  systemAuthors.set(document, (kind, input) => {
    let intent: SystemIntent | undefined;
    let copyFailure: ReturnType<typeof caught> | undefined;
    try {
      const copied = json(input, configureLimits(options.limits), "SYSTEM_EVENT_INVALID", "system");
      if (
        !copied ||
        typeof copied !== "object" ||
        Array.isArray(copied) ||
        Object.hasOwn(copied, "kind")
      )
        fail("SYSTEM_EVENT_INVALID", "system");
      intent = { ...copied, kind } as SystemIntent;
    } catch (cause) {
      copyFailure = caught(cause, "SYSTEM_EVENT_INVALID", "system");
    }
    return serialized(() => {
      const ready = authoring();
      if (copyFailure) return { ok: false, error: copyFailure };
      return commitIntents(ready, [intent!], configureLimits(options.limits));
    });
  });
  return document;
}
export async function createDocument<
  S extends Json,
  C extends Record<string, Json>,
  E extends DomainEvent,
>(input: {
  model: ApplicationModel<S, C, E>;
  system: SystemProfile;
  identity: IdentityCapability;
  mode?: "immediate" | "draft";
  limits?: Partial<Limits>;
}): Promise<Result<DocumentHandle<S, C>>> {
  try {
    const options = copyOptions({ ...input, signer: input.identity } as unknown as Options),
      lim = configureLimits(options.limits);
    host(options);
    if (
      !options.model ||
      !options.system ||
      !options.signer ||
      !same(options.system.ref, { id: "concord.standard", version: 1 })
    )
      fail("HOST_CONFIGURATION", "requirements");
    let bootstrap: Result<EntrySubject>;
    try {
      bootstrap = await options.system.bootstrap({ signer: options.signer, limits: lim });
    } catch {
      fail("SYSTEM_FAILED", "system");
    }
    if (!bootstrap.ok) return bootstrap;
    const wire = await candidate(null, [bootstrap.value], options.signer, options, lim),
      bytes = encodeJson(wire, lim.maxDepth),
      evaluated = await evaluate(bytes, options, (fn) => fn());
    if (evaluated.state.status !== "ready")
      return { ok: false, error: evaluated.inspection.findings[0] };
    return ok(handle(evaluated, bytes, options) as unknown as DocumentHandle<S, C>);
  } catch (cause) {
    return { ok: false, error: caught(cause, "HOST_CONFIGURATION", "requirements") };
  }
}
export async function openDocument<
  S extends Json = never,
  C extends Record<string, Json> = Record<never, never>,
  E extends DomainEvent = DomainEvent,
>(input: HostOptions<S, C, E> & { bytes: Uint8Array }): Promise<DocumentHandle<S, C>> {
  const bytes = new Uint8Array(input.bytes);
  let options: Options;
  try {
    options = copyOptions(input as unknown as Options);
  } catch {
    options = { limits: input.limits, invalidHost: true };
  }
  const evaluated = await evaluate(bytes, options, (fn) => fn());
  if ("snapshot" in evaluated) {
    const lim = configureLimits(options.limits);
    return handle(
      evaluated,
      encodeJson(evaluated.snapshot, lim.maxDepth),
      options,
    ) as unknown as DocumentHandle<S, C>;
  }
  return handle(evaluated, bytes, options) as unknown as DocumentHandle<S, C>;
}

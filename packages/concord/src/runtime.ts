import { createLedger, type LedgerAppendInput, type LedgerInstance } from "@ternent/ledger";
import { caught, error, fail, ok, type Result, Fault } from "./common/errors.js";
import { detached, freeze } from "./common/immutable.js";
import { encodeJson } from "./protocol/json.js";
import { inspectProtocol, ledgerLimits, compareSnapshots } from "./protocol/verify.js";
import {
  isAudienceId,
  object,
  limits as configureLimits,
  ref,
  declaration as frameworkDeclaration,
  entrySubject,
} from "./protocol/schema.js";
import { issueHistory } from "./protocol/history.js";
import type {
  AudienceId,
  Json,
  JsonObject,
  CommitId,
  DomainEvent,
  Snapshot,
  Limits,
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
  DraftReceipt,
} from "./model/types.js";
import { systemAuthors } from "./system/authoring.js";
import type {
  SystemProfile,
  SystemReplay,
  ApplicationIntent,
  SystemIntent,
} from "./system/types.js";
import { host, copyOptions, type Options } from "./runtime/host.js";
import { accepted, checkRequirements, json, same } from "./runtime/validation.js";
import { checkSystem } from "./runtime/system-output.js";
import { fold } from "./runtime/model-replay.js";
import type { IdentityCapability } from "@ternent/armour";
type Evaluation =
  | { inspection: InspectionReport; state: InspectionState }
  | {
      inspection: InspectionReport;
      state: ReadyState<Json>;
      snapshot: Snapshot;
      system: SystemReplay;
    };
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
    entries: null,
    audiences: null,
  };
  const inspect = (reason: InspectionState["reason"]): Evaluation => ({
    inspection: detached(report),
    state: { status: "inspection", reason },
  });
  if (!protocol.snapshot)
    return inspect(protocol.report.integrity === "invalid" ? "invalid" : "incompatible");
  const wire = detached(protocol.snapshot),
    declaration = frameworkDeclaration(wire);
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
    if (
      (options.reader && !same(system.reader, options.reader.publicIdentity)) ||
      (!options.reader && options.signer && !same(system.reader, options.signer.publicIdentity)) ||
      (!options.reader && !options.signer && system.reader !== null)
    )
      fail("SYSTEM_FAILED", "system");
  } catch (cause) {
    const finding = caught(cause, "SYSTEM_FAILED", "system");
    report.findings = [finding];
    report.system =
      finding.code === "UNSUPPORTED_SYSTEM_EVENT" || finding.code === "RESOURCE_LIMIT"
        ? "unsupported"
        : "invalid";
    return inspect(report.system === "unsupported" ? "incompatible" : "invalid");
  }
  report.system = "valid";
  report.entries = system.entries;
  report.audiences = system.audiences;
  const lockedEntries = system.entries.filter((item) => item.status === "locked").length;
  report.lockedEntries = lockedEntries;
  if ((!system.reader || lockedEntries > 0) && !options.model!.reduceLocked) {
    report.application = "locked";
    report.findings = [
      error(!system.reader ? "READ_ACCESS_REQUIRED" : "KEY_UNAVAILABLE", "system"),
    ];
    return inspect("locked");
  }
  try {
    const projection = fold(options.model!, system, lim, call);
    const coverage = lockedEntries > 0 ? "readable" : "complete";
    report.application = coverage === "complete" ? "valid" : "scoped";
    const signer = options.signer;
    const canWrite = Boolean(
      signer &&
      system.audiences.some((group) =>
        group.members.some(
          (m) => same(m.identity, signer.publicIdentity) && m.capabilities.includes("write"),
        ),
      ),
    );
    return {
      inspection: detached(report),
      snapshot: wire,
      system,
      state: freeze({
        status: "ready",
        documentId: wire.documentId,
        head: wire.head,
        projection,
        canWrite,
        coverage,
        lockedEntries,
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
function preparedInputs(
  subjects: readonly EntrySubject[],
  parent: CommitId | null,
  lim: Limits,
): LedgerAppendInput[] {
  return subjects.map((subject) => {
    entrySubject(subject, "", lim);
    if (subject.parent !== parent) fail("SYSTEM_FAILED", "system");
    return { kind: subject.kind, nonce: subject.nonce, payload: subject.payload };
  });
}
async function newLedger(
  options: Options,
  lim: Limits,
  call: <T>(fn: () => T) => T,
): Promise<LedgerInstance<null>> {
  return createLedger({
    initialProjection: null,
    projector: () => null,
    limits: ledgerLimits(lim),
    signer: options.signer
      ? {
          publicIdentity: options.signer.publicIdentity,
          sign: (message) => call(() => options.signer!.sign(message)),
        }
      : undefined,
  });
}
async function handle(
  initial: Evaluation,
  input: Uint8Array,
  options: Options,
): Promise<DocumentHandle<Json, Record<string, Json>>> {
  let current = initial,
    callbacks = 0;
  let bytes: Uint8Array = new Uint8Array(input);
  let queue: Promise<unknown> = Promise.resolve();
  let pendingDraft: {
    baseHead: CommitId;
    intents: readonly ApplicationIntent[];
    preview: Readonly<Json>;
  } | null = null;
  const call = <T>(fn: () => T): T => {
    callbacks++;
    try {
      return fn();
    } finally {
      callbacks--;
    }
  };
  let active: LedgerInstance<null> | null = null;
  if ("snapshot" in initial) {
    active = await newLedger(options, configureLimits(options.limits), call);
    await active.load(initial.snapshot);
  }
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
    metadata: JsonObject | null = null,
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
          ? entry.kind !== "application" || entry.payload.audience !== intent.audience
          : entry.kind !== "system" || entry.payload.type !== `system.${intent.kind}`;
      })
    )
      fail("SYSTEM_FAILED", "system");
    if (!active) fail("INSPECTION_ONLY", "author");
    const candidate = await newLedger(options, lim, call);
    await candidate.load(await active.export());
    await candidate.appendMany(
      preparedInputs(json(prepared.value, lim, "SYSTEM_FAILED"), ready.snapshot.head, lim),
    );
    await candidate.commit(metadata === null ? {} : { metadata });
    const wire = await candidate.export();
    const nextBytes = encodeJson(wire, lim.maxDepth),
      next = await evaluate(nextBytes, options, call);
    if (next.state.status !== "ready") return { ok: false, error: next.inspection.findings[0] };
    current = next;
    active = candidate;
    bytes = nextBytes;
    pendingDraft = null;
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
      detached(
        active
          ? ((await active.verify()) as InspectionReport["verification"])
          : (await inspectProtocol(new Uint8Array(bytes), { limits: options.limits })).report,
      ),
    async replay() {
      if (current.state.status !== "ready")
        return {
          ok: false,
          error: current.inspection.findings[0] ?? error("INSPECTION_ONLY", "author"),
        };
      const result = await evaluate(new Uint8Array(bytes), options, call);
      return result.state.status === "ready"
        ? ok(
            detached({
              projection: result.state.projection,
              coverage: result.state.coverage,
              lockedEntries: result.state.lockedEntries,
            }),
          )
        : { ok: false, error: result.inspection.findings[0] };
    },
    dispatch(command, input) {
      let copied: Json | undefined, copyFailure: ReturnType<typeof caught> | undefined;
      try {
        copied = json(input, configureLimits(options.limits), "COMMAND_INVALID", "author");
      } catch (cause) {
        copyFailure = caught(cause, "COMMAND_INVALID", "author");
      }
      return serialized<CommitReceipt | DraftReceipt>(async () => {
        const ready = writable(),
          model = options.model!,
          lim = configureLimits(options.limits);
        if (!Object.hasOwn(model.commands, command)) fail("COMMAND_UNSUPPORTED", "author");
        if (copyFailure) return { ok: false, error: copyFailure };
        const registration = model.commands[command];
        const actor = options.signer!.publicIdentity;
        const validated = json(
          accepted(
            call(() => registration.validate(copied)),
            "COMMAND_INVALID",
          ),
          lim,
          "COMMAND_INVALID",
          "author",
        );
        const audience: AudienceId = call(() =>
          registration.audience ? registration.audience(validated) : "document",
        );
        if (!isAudienceId(audience)) fail("COMMAND_INVALID", "author");
        const group = ready.system.audiences.find((group) => group.audience === audience);
        const member = group?.members.find((m) => same(m.identity, actor));
        if (!group || !member?.capabilities.includes("write")) fail("CAPABILITY_DENIED", "system");
        const facts = detached({
          audience,
          actor,
          capabilities: member.capabilities,
          members: group.members,
        });
        const events = accepted(
          call(() =>
            registration.decide(
              validated,
              pendingDraft ? pendingDraft.preview : ready.state.projection,
              {
                facts,
              },
            ),
          ),
          "COMMAND_REJECTED",
        );
        if (!Array.isArray(events)) fail("MODEL_FAILED", "model");
        if (!events.length) fail("NO_EVENTS", "author");
        if (
          options.mode === "draft" &&
          (ready.snapshot.entries.length + (pendingDraft?.intents.length ?? 0) + events.length >
            lim.maxEntries ||
            ready.snapshot.commits.length + 1 > lim.maxCommits)
        )
          fail("RESOURCE_LIMIT", "author");
        const intents: ApplicationIntent[] = events.map((input) => {
          const event = json(
            accepted(
              call(() => model.validateEvent(input)),
              "EVENT_INVALID",
            ),
            lim,
            "EVENT_INVALID",
          );
          if (!object(event) || Object.keys(event).length !== 3 || !Object.hasOwn(event, "data"))
            fail("EVENT_INVALID", "model");
          try {
            ref({ id: event.type, version: event.version }, "");
          } catch {
            fail("EVENT_INVALID", "model");
          }
          const eventAudience = call(() => (model.audience ? model.audience(event) : "document"));
          if (!isAudienceId(eventAudience) || eventAudience !== audience)
            fail("EVENT_INVALID", "model");
          const required = call(() => model.requirements(event));
          checkRequirements(required);
          if (!required.every((capability) => member.capabilities.includes(capability)))
            fail("CAPABILITY_DENIED", "system");
          return detached({
            kind: "application" as const,
            event,
            required,
            audience,
          });
        });
        if (options.mode === "draft") {
          const staged = json([...(pendingDraft?.intents ?? []), ...intents], lim, "EVENT_INVALID");
          let preview = pendingDraft ? pendingDraft.preview : ready.state.projection;
          for (const intent of intents) {
            preview = json(
              accepted(
                call(() => model.reduce(preview, intent.event, facts)),
                "MODEL_TRANSITION_INVALID",
              ),
              lim,
              "MODEL_TRANSITION_INVALID",
            );
          }
          pendingDraft = { baseHead: ready.snapshot.head, intents: staged, preview };
          return ok({
            status: "staged" as const,
            baseHead: ready.snapshot.head,
            entryCount: staged.length,
          });
        }
        return commitIntents(ready, intents, lim);
      });
    },
    commit(metadata) {
      let copied: JsonObject | null = null,
        copyFailure: ReturnType<typeof caught> | undefined;
      try {
        const lim = configureLimits(options.limits);
        if (metadata !== undefined) {
          copied = json(metadata, lim, "SCHEMA_INVALID", "author");
          if (!object(copied)) fail("SCHEMA_INVALID", "author");
          if (encodeJson(copied, lim.maxDepth).length > lim.maxMetadataBytes)
            fail("RESOURCE_LIMIT", "author");
        }
      } catch (cause) {
        copyFailure = caught(cause, "SCHEMA_INVALID", "author");
      }
      return serialized(() => {
        const ready = writable();
        if (options.mode !== "draft" || !pendingDraft) fail("NO_DRAFT", "author");
        if (copyFailure) return { ok: false, error: copyFailure };
        if (pendingDraft.baseHead !== ready.snapshot.head) fail("HEAD_CONFLICT", "author");
        return commitIntents(ready, pendingDraft.intents, configureLimits(options.limits), copied);
      });
    },
    discardDraft: () =>
      serialized(() => {
        writable();
        pendingDraft = null;
        return ok(undefined);
      }),
    draft: () =>
      pendingDraft
        ? detached({
            baseHead: pendingDraft.baseHead,
            entryCount: pendingDraft.intents.length,
            preview: pendingDraft.preview,
          })
        : null,
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
      intent = {
        ...copied,
        ...(kind !== "group.create" && !Object.hasOwn(copied, "audience")
          ? { audience: "document" }
          : {}),
        kind,
      } as SystemIntent;
    } catch (cause) {
      copyFailure = caught(cause, "SYSTEM_EVENT_INVALID", "system");
    }
    return serialized(() => {
      const ready = authoring();
      if (pendingDraft) fail("DRAFT_PENDING", "author");
      if (options.mode === "draft") fail("HOST_CONFIGURATION", "requirements");
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
    const ledger = await newLedger(options, lim, (fn) => fn());
    await ledger.create({
      metadata: { concord: { model: options.model.ref, system: options.system.ref } },
      entries: preparedInputs([json(bootstrap.value, lim, "SYSTEM_FAILED")], null, lim),
    });
    const wire = await ledger.export(),
      bytes = encodeJson(wire, lim.maxDepth),
      evaluated = await evaluate(bytes, options, (fn) => fn());
    if (evaluated.state.status !== "ready")
      return { ok: false, error: evaluated.inspection.findings[0] };
    return ok((await handle(evaluated, bytes, options)) as unknown as DocumentHandle<S, C>);
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
    return (await handle(
      evaluated,
      encodeJson(evaluated.snapshot, lim.maxDepth),
      options,
    )) as unknown as DocumentHandle<S, C>;
  }
  return (await handle(evaluated, bytes, options)) as unknown as DocumentHandle<S, C>;
}

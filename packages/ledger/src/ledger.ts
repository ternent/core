import * as protocol from "./protocol/verify.js";
import { encodeBase64Url, validatePublicIdentity } from "@ternent/identity";
import { detached, encodeJson, fail, Fault, nonce, parseJson } from "./protocol/index.js";
import { appendInput, limits, snapshot, timestamp } from "./schema.js";
import type { CommitId, JsonObject, VerificationReport } from "./protocol/index.js";
import type {
  CreateLedgerConfig,
  LedgerOptions,
  LedgerInstance,
  LedgerState,
  LedgerSnapshot,
  LedgerReplayEntry,
  LedgerEntryRecord,
  LedgerAppendInput,
  LedgerCommitSubject,
  LedgerCommitRecord,
} from "./types.js";

function optionsObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function createLedger<P>(config: CreateLedgerConfig<P>): Promise<LedgerInstance<P>>;
export function createLedger(config?: LedgerOptions): Promise<LedgerInstance<LedgerReplayEntry[]>>;
export async function createLedger<P>(
  config: LedgerOptions | CreateLedgerConfig<P> = {},
): Promise<LedgerInstance<P>> {
  if (
    !optionsObject(config) ||
    Object.keys(config).some(
      (key) => !["signer", "limits", "now", "initialProjection", "projector"].includes(key),
    ) ||
    "initialProjection" in config !== "projector" in config
  )
    fail("HOST_CONFIGURATION", "requirements");
  const lim = limits(config.limits);
  const copy = <T>(value: T): T =>
    parseJson(encodeJson(value, lim.maxDepth), lim.maxDepth, lim.maxBytes) as unknown as T;
  const initial = detached(
    copy("initialProjection" in config ? config.initialProjection : ([] as unknown as P)),
  );
  const projector =
    "projector" in config
      ? config.projector
      : (projection: P, entry: LedgerReplayEntry) =>
          [...(projection as unknown as LedgerReplayEntry[]), entry] as unknown as P;
  if (
    typeof projector !== "function" ||
    (config.now !== undefined && typeof config.now !== "function")
  )
    fail("HOST_CONFIGURATION", "requirements");
  const now = config.now ?? (() => new Date().toISOString());
  const signer = config.signer && {
    publicIdentity: detached(config.signer.publicIdentity),
    sign: config.signer.sign,
  };
  if (
    signer &&
    (!validatePublicIdentity(signer.publicIdentity).ok || typeof signer.sign !== "function")
  )
    fail("HOST_CONFIGURATION", "requirements");
  let state: Readonly<LedgerState<P>> = detached({
    container: null,
    staged: [],
    projection: initial,
    verification: null,
  });
  let queue: Promise<unknown> = Promise.resolve();
  let callbacks = 0;
  let destroyed = false;
  const listeners = new Set<(state: Readonly<LedgerState<P>>) => void>();
  const call = <T>(fn: () => T): T => {
    callbacks++;
    try {
      return fn();
    } finally {
      callbacks--;
    }
  };
  const clock = () => {
    const value = call(now);
    timestamp(value);
    return value;
  };
  function submit<T>(prepare: () => () => T | Promise<T>): Promise<T> {
    try {
      if (callbacks) fail("HOST_CONFIGURATION", "requirements");
      if (destroyed) fail("LEDGER_DESTROYED", "author");
      const body = prepare();
      const pending = queue.then(() => {
        if (destroyed) fail("LEDGER_DESTROYED", "author");
        return body();
      });
      queue = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    } catch (cause) {
      return Promise.reject(cause);
    }
  }
  function publish(next: LedgerState<P>): void {
    state = detached(next);
    for (const listener of listeners) {
      // An observer cannot undo an already published commit or poison the mutation queue.
      try {
        call(() => listener(state));
      } catch {
        /* Observer owns its failure. */
      }
    }
  }
  function created(): LedgerSnapshot {
    if (!state.container) fail("LEDGER_NOT_CREATED", "author");
    return state.container;
  }
  function writer() {
    if (!signer) fail("READ_ONLY_RUNTIME", "author");
    return signer;
  }
  function project(container: LedgerSnapshot, staged: readonly LedgerEntryRecord[]): P {
    let projection = detached(initial);
    const reduce = (entry: LedgerEntryRecord, commitId: LedgerCommitRecord["id"] | null) => {
      const event = detached({
        ...entry.subject,
        entryId: entry.id,
        commitId,
        committed: commitId !== null,
      });
      projection = detached(copy(call(() => projector(projection, event))));
    };
    for (const { commit, entry } of protocol.orderedEntries(container)) reduce(entry, commit.id);
    for (const entry of staged) reduce(entry, null);
    return projection;
  }
  async function verified(
    bytes: Uint8Array,
  ): Promise<{ container: LedgerSnapshot; report: VerificationReport }> {
    const result = await protocol.inspectProtocol(bytes, { limits: lim });
    if (!result.snapshot) throw new Fault(result.report.findings[0]);
    return { container: detached(result.snapshot), report: detached(result.report) };
  }
  function metadata(input: { metadata?: JsonObject }): JsonObject | null {
    if (!optionsObject(input) || Object.keys(input).some((key) => key !== "metadata"))
      fail("SCHEMA_INVALID", "input");
    const value = input.metadata ?? null;
    if (value !== null && (typeof value !== "object" || Array.isArray(value)))
      fail("SCHEMA_INVALID", "input");
    if (encodeJson(value, lim.maxDepth).length > lim.maxMetadataBytes)
      fail("RESOURCE_LIMIT", "input");
    return value;
  }
  async function candidate(
    base: LedgerSnapshot | null,
    entries: readonly LedgerEntryRecord[],
    meta: JsonObject | null,
  ) {
    const identity = writer();
    const subject: LedgerCommitSubject = {
      version: 1,
      suite: "ledger-ed25519-v1",
      parent: base?.head ?? null,
      nonce: nonce(),
      signer: identity.publicIdentity,
      committedAt: clock(),
      entryIds: entries.map((entry) => entry.id),
      metadata: meta,
    };
    const id = protocol.identifier(subject, "commit", lim.maxDepth);
    const commit = { id, subject, signature: encodeBase64Url(new Uint8Array(64)) };
    const container: LedgerSnapshot = {
      format: "ledger",
      version: 1,
      documentId: base?.documentId ?? id,
      head: id,
      commits: [...(base?.commits ?? []), commit],
      entries: [...(base?.entries ?? []), ...entries],
    };
    if (encodeJson(container, lim.maxDepth).length > lim.maxBytes) fail("RESOURCE_LIMIT", "author");
    snapshot(container, lim);
    const message = protocol.signatureMessage(subject, lim.maxDepth);
    let signature: Awaited<ReturnType<typeof identity.sign>>;
    try {
      signature = await call(() => identity.sign(message));
    } catch {
      fail("SIGNING_FAILED", "author");
    }
    if (!signature.ok || !(signature.value instanceof Uint8Array) || signature.value.length !== 64)
      fail("SIGNING_FAILED", "author");
    commit.signature = encodeBase64Url(signature.value);
    return { ...(await verified(encodeJson(container, lim.maxDepth))), commit };
  }
  function load(input: LedgerSnapshot | Uint8Array): Promise<void> {
    return submit(() => {
      if (input instanceof Uint8Array && input.byteLength > lim.maxBytes)
        fail("RESOURCE_LIMIT", "input");
      const bytes =
        input instanceof Uint8Array ? new Uint8Array(input) : encodeJson(input, lim.maxDepth);
      return async () => {
        if (state.staged.length) fail("DRAFT_PENDING", "author");
        const next = await verified(bytes);
        publish({
          container: next.container,
          verification: next.report,
          staged: [],
          projection: project(next.container, []),
        });
      };
    });
  }
  function makeEntries(
    parent: CommitId | null,
    inputs: readonly LedgerAppendInput[],
  ): LedgerEntryRecord[] {
    const identity = writer();
    return inputs.map((input) => {
      const subject = {
        version: 1 as const,
        parent,
        nonce: input.nonce ?? nonce(),
        kind: input.kind,
        author: identity.publicIdentity.id,
        authoredAt: clock(),
        meta: input.meta ?? null,
        payload: { type: "plain" as const, data: input.payload ?? null },
      };
      return { id: protocol.identifier(subject, "entry", lim.maxDepth), subject };
    });
  }
  function uniqueNonces(entries: readonly LedgerEntryRecord[]): void {
    if (new Set(entries.map((entry) => entry.subject.nonce)).size !== entries.length)
      fail("SCHEMA_INVALID", "author", "/nonce");
  }
  function appendBatch(inputs: readonly LedgerAppendInput[]) {
    return submit(() => {
      const captured = copy(inputs);
      if (!Array.isArray(captured) || !captured.length) fail("NO_ENTRIES", "author");
      for (const input of captured) appendInput(input, lim);
      return () => {
        const base = created();
        if (base.entries.length + state.staged.length + captured.length > lim.maxEntries)
          fail("RESOURCE_LIMIT", "author");
        const entries = makeEntries(base.head, captured);
        const staged = [...state.staged, ...entries];
        uniqueNonces(staged);
        if (
          encodeJson({ ...base, entries: [...base.entries, ...staged] }, lim.maxDepth).length >
          lim.maxBytes
        )
          fail("RESOURCE_LIMIT", "author");
        publish({ ...state, staged, projection: project(base, staged) });
        return { entries: detached(entries), stagedCount: staged.length };
      };
    });
  }
  const ledger: LedgerInstance<P> = {
    create(input = {}) {
      return submit(() => {
        const captured = copy(input);
        if (
          !optionsObject(captured) ||
          Object.keys(captured).some((key) => !["metadata", "entries"].includes(key))
        )
          fail("SCHEMA_INVALID", "input");
        const meta = metadata(
          captured.metadata === undefined ? {} : { metadata: captured.metadata },
        );
        const inputs = captured.entries ?? [];
        if (!Array.isArray(inputs) || inputs.length > lim.maxEntries)
          fail("RESOURCE_LIMIT", "input");
        for (const entry of inputs) appendInput(entry, lim);
        return async () => {
          if (state.container) fail("LEDGER_ALREADY_CREATED", "author");
          const entries = makeEntries(null, inputs);
          uniqueNonces(entries);
          const next = await candidate(null, entries, meta);
          publish({
            container: next.container,
            staged: [],
            projection: project(next.container, []),
            verification: next.report,
          });
        };
      });
    },
    load,
    import: load,
    async append(input) {
      const result = await appendBatch([input]);
      return { entry: result.entries[0], stagedCount: result.stagedCount };
    },
    async appendMany(inputs) {
      return (await appendBatch(inputs)).entries;
    },
    commit(input = {}) {
      return submit(() => {
        const meta = metadata(copy(input));
        return async () => {
          const base = created();
          if (!state.staged.length) fail("NO_ENTRIES", "author");
          const entries = state.staged;
          const next = await candidate(base, entries, meta);
          const projection = project(next.container, []);
          publish({ container: next.container, staged: [], projection, verification: next.report });
          return detached({
            commit: next.commit,
            committedEntries: entries,
            committedEntryIds: next.commit.subject.entryIds,
          });
        };
      });
    },
    replay(options = {}) {
      return submit(() => {
        const captured = copy(options);
        if (
          !optionsObject(captured) ||
          Object.keys(captured).some((key) => key !== "includeStaged") ||
          (captured.includeStaged !== undefined && typeof captured.includeStaged !== "boolean")
        )
          fail("HOST_CONFIGURATION", "requirements");
        return () => project(created(), captured.includeStaged === false ? [] : state.staged);
      });
    },
    recompute() {
      return submit(() => () => {
        const projection = project(created(), state.staged);
        publish({ ...state, projection });
        return projection;
      });
    },
    verify() {
      return submit(
        () => () => protocol.verifyDocument(encodeJson(created(), lim.maxDepth), { limits: lim }),
      );
    },
    export() {
      return submit(() => () => detached(created()));
    },
    getState: () => state,
    subscribe(listener) {
      if (destroyed || typeof listener !== "function") fail("HOST_CONFIGURATION", "requirements");
      listeners.add(listener);
      try {
        call(() => listener(state));
      } catch {
        /* Observer owns its failure. */
      }
      return () => {
        listeners.delete(listener);
      };
    },
    clearStaged() {
      return submit(
        () => () => publish({ ...state, staged: [], projection: project(created(), []) }),
      );
    },
    destroy() {
      return submit(() => () => {
        destroyed = true;
        publish({ container: null, staged: [], projection: initial, verification: null });
        listeners.clear();
      });
    },
  };
  return Object.freeze(ledger);
}

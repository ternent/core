import { expect, test, vi } from "vite-plus/test";
import { identityFromSeed, type IdentityCapability } from "@ternent/armour";
import {
  createDocument,
  defineModel,
  openDocument,
  type ApplicationModel,
  type AudienceId,
  type DocumentHandle,
  type JsonObject,
  type ModelIssue,
  type Result,
  type Snapshot,
} from "../src/index.js";
import { createGroup, createStandardSystemProfile, setMember } from "../src/system/index.js";
import { seed } from "./fixtures.js";

type Input = { audience: AudienceId; key: string; value: string };
type Commands = { set: Input };
type State = { values: Record<string, string>; order: string[] };
type Event = {
  type: "draft.value";
  version: 1;
  data: Input & { previous: string | null };
};
type Model = ApplicationModel<State, Commands, Event>;
const success = <T>(value: T): Result<T, ModelIssue> => ({ ok: true, value });
const issue = (code: string): { ok: false; error: ModelIssue } => ({
  ok: false,
  error: { code, message: code },
});
const failure = (code: string) => ({ ok: false, error: { code } });
function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const ownerIdentity = async () => value(await identityFromSeed(seed));
const set = (key: string, text: string, audience: AudienceId = "document"): Input => ({
  audience,
  key,
  value: text,
});
const wire = (bytes: Uint8Array): Snapshot =>
  JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
function model(): Model {
  return defineModel<State, Commands, Event>({
    ref: { id: "concord.test.drafts", version: 1 },
    initial: () => ({ values: {}, order: [] }),
    commands: {
      set: {
        validate(input) {
          if (!input || typeof input !== "object") return issue("INPUT_INVALID");
          const record = input as Record<string, unknown>;
          if (
            typeof record.audience !== "string" ||
            typeof record.key !== "string" ||
            typeof record.value !== "string"
          )
            return issue("INPUT_INVALID");
          return success({
            audience: record.audience as AudienceId,
            key: record.key,
            value: record.value,
          });
        },
        audience: (input) => input.audience,
        decide: (input, state) =>
          success([
            {
              type: "draft.value",
              version: 1,
              data: { ...input, previous: state.values[input.key] ?? null },
            },
          ]),
      },
    },
    validateEvent(input) {
      if (!input || typeof input !== "object") return issue("EVENT_INVALID");
      const event = input as Event;
      if (
        event.type !== "draft.value" ||
        event.version !== 1 ||
        !event.data ||
        typeof event.data.audience !== "string" ||
        typeof event.data.key !== "string" ||
        typeof event.data.value !== "string" ||
        (event.data.previous !== null && typeof event.data.previous !== "string")
      )
        return issue("EVENT_INVALID");
      return success(event);
    },
    audience: (event) => event.data.audience,
    requirements: () => ["write"],
    reduce(state, event) {
      if ((state.values[event.data.key] ?? null) !== event.data.previous)
        return issue("PREVIOUS_VALUE_INVALID");
      return success({
        values: { ...state.values, [event.data.key]: event.data.value },
        order: [...state.order, `${event.data.audience}:${event.data.value}`],
      });
    },
  });
}
const create = async (identity: IdentityCapability, definition = model()) =>
  value(
    await createDocument({ identity, model: definition, system: createStandardSystemProfile() }),
  );
const openDraft = (bytes: Uint8Array, signer: IdentityCapability, definition = model()) =>
  openDocument({
    bytes,
    signer,
    mode: "draft",
    model: definition,
    system: createStandardSystemProfile(),
  });

test("draft creation commits only genesis and subsequent commands decide against the staged preview", async () => {
  const owner = await ownerIdentity();
  const profile = createStandardSystemProfile();
  const prepare = vi.fn(profile.prepare);
  const sign = vi.fn(owner.sign);
  const document = value(
    await createDocument({
      identity: { ...owner, sign },
      model: model(),
      system: { ...profile, prepare },
      mode: "draft",
    }),
  );
  expect(wire(document.export()).commits).toHaveLength(1);
  expect(wire(document.export()).entries).toHaveLength(1);
  expect(sign).toHaveBeenCalledOnce();
  expect(prepare).not.toHaveBeenCalled();
  sign.mockClear();
  const before = document.export();
  const beforeState = document.state();
  const head = wire(before).head;
  expect(document.draft()).toBeNull();
  expect(value(await document.dispatch("set", set("same", "first")))).toEqual({
    status: "staged",
    baseHead: head,
    entryCount: 1,
  });
  expect(value(await document.dispatch("set", set("same", "second")))).toEqual({
    status: "staged",
    baseHead: head,
    entryCount: 2,
  });
  expect(document.draft()).toEqual({
    baseHead: head,
    entryCount: 2,
    preview: { values: { same: "second" }, order: ["document:first", "document:second"] },
  });
  expect(document.state()).toEqual(beforeState);
  expect(document.export()).toEqual(before);
  expect(document.inspect().entries).toEqual([]);
  expect((await document.verify()).integrity).toBe("valid");
  expect(value(await document.replay())).toEqual({
    projection: { values: {}, order: [] },
    coverage: "complete",
    lockedEntries: 0,
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
  const receipt = value(await document.commit({ note: "one explicit batch" }));
  expect(receipt.entryIds).toHaveLength(2);
  expect(prepare).toHaveBeenCalledOnce();
  expect(sign).toHaveBeenCalledOnce();
  expect(wire(document.export()).commits).toHaveLength(2);
  expect(wire(document.export()).commits.at(-1)!.subject.metadata).toEqual({
    note: "one explicit batch",
  });
  expect(document.draft()).toBeNull();
  expect(document.state()).toMatchObject({
    head: receipt.head,
    projection: { values: { same: "second" }, order: ["document:first", "document:second"] },
  });
  expect((await openDraft(document.export(), owner)).state()).toEqual(document.state());
});

test("one explicit draft commit can contain ordered commands for independent audiences", async () => {
  const owner = await ownerIdentity();
  const immediate = await create(owner);
  const first = value(await createGroup(immediate)).audience;
  const second = value(await createGroup(immediate)).audience;
  const document = await openDraft(immediate.export(), owner);
  const before = wire(document.export());
  for (const input of [
    set("default", "one"),
    set("first", "two", first),
    set("second", "three", second),
  ])
    value(await document.dispatch("set", input));
  const preview = document.draft()!.preview;
  value(await document.commit());
  const committed = wire(document.export());
  expect(committed.commits).toHaveLength(before.commits.length + 1);
  expect(committed.commits.at(-1)!.subject.entryIds).toHaveLength(3);
  expect(
    committed.entries.slice(-3).map(({ subject }) => {
      if (subject.kind !== "application") throw new Error("Expected staged application entry");
      return subject.payload.audience;
    }),
  ).toEqual(["document", first, second]);
  expect(document.state()).toMatchObject({ projection: preview });
  expect(value(await document.replay()).projection).toEqual(preview);
});

test("staging captures inputs and returns detached previews while rejected dispatch preserves the existing draft", async () => {
  const owner = await ownerIdentity();
  const document = await openDraft((await create(owner)).export(), owner);
  const input = set("captured", "original");
  const pending = document.dispatch("set", input);
  input.value = "mutated before queued validation";
  value(await pending);
  const staged = document.draft()!;
  expect(staged.preview.values.captured).toBe("original");
  try {
    (staged.preview.values as Record<string, string>).captured = "external mutation";
  } catch {
    /* Frozen copies are allowed. */
  }
  expect(document.draft()!.preview.values.captured).toBe("original");
  const before = document.export();
  const draft = document.draft();
  expect(
    await document.dispatch("set", { ...set("invalid", "invalid"), value: 42 } as unknown as Input),
  ).toMatchObject(failure("COMMAND_INVALID"));
  expect(
    await document.dispatch("set", set("denied", "denied", `group:${"A".repeat(22)}`)),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  expect(document.draft()).toEqual(draft);
  expect(document.export()).toEqual(before);
  value(await document.dispatch("set", set("captured", "next")));
  expect(document.draft()!.entryCount).toBe(2);
  value(await document.commit());
  expect(document.state()).toMatchObject({ projection: { values: { captured: "next" } } });
});

test("discard removes only pending work and empty or immediate commits return NO_DRAFT", async () => {
  const owner = await ownerIdentity();
  const immediate = await create(owner);
  value(await immediate.dispatch("set", set("committed", "retained")));
  expect(await immediate.commit()).toMatchObject(failure("NO_DRAFT"));
  const document = await openDraft(immediate.export(), owner);
  const before = document.export();
  const state = document.state();
  expect(await document.commit()).toMatchObject(failure("NO_DRAFT"));
  value(await document.dispatch("set", set("pending", "discarded")));
  value(await document.discardDraft());
  expect(document.draft()).toBeNull();
  expect(document.export()).toEqual(before);
  expect(document.state()).toEqual(state);
  expect(await document.commit()).toMatchObject(failure("NO_DRAFT"));
  value(await document.dispatch("set", set("new", "replacement")));
  expect(document.draft()!.entryCount).toBe(1);
});

test("system helpers never implicitly change draft authoring mode", async () => {
  const owner = await ownerIdentity();
  const other = value(await identityFromSeed(new Uint8Array(32).fill(2)));
  const immediate = await create(owner);
  value(await createGroup(immediate));
  const document = await openDraft(immediate.export(), owner);
  const before = document.export();
  expect(await createGroup(document)).toMatchObject(failure("HOST_CONFIGURATION"));
  expect(
    await setMember(document, { identity: other.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("HOST_CONFIGURATION"));
  value(await document.dispatch("set", set("pending", "keep draft")));
  const draft = document.draft();
  expect(await createGroup(document)).toMatchObject(failure("DRAFT_PENDING"));
  expect(
    await setMember(document, { identity: other.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("DRAFT_PENDING"));
  expect(document.export()).toEqual(before);
  expect(document.draft()).toEqual(draft);
});

test("draft mutations retain signer-free and inspection-only guards", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  const readOnly = await openDocument({
    bytes,
    reader: owner,
    mode: "draft",
    model: model(),
    system: createStandardSystemProfile(),
  });
  const incompatible = model();
  incompatible.ref = { ...incompatible.ref, version: 2 };
  const inspection = await openDraft(bytes, owner, incompatible);
  for (const [handle, code] of [
    [readOnly, "READ_ONLY_RUNTIME"],
    [inspection, "INSPECTION_ONLY"],
  ] as const) {
    expect(await handle.dispatch("set", set("denied", "denied"))).toMatchObject(failure(code));
    expect(await handle.commit()).toMatchObject(failure(code));
    expect(await handle.discardDraft()).toMatchObject(failure(code));
    expect(handle.export()).toEqual(bytes);
    expect(handle.draft()).toBeNull();
  }
});

test("preparation and signing failures preserve pending intents for an explicit retry", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  for (const phase of ["prepare", "sign"] as const) {
    const profile = createStandardSystemProfile();
    const prepare = vi.fn(profile.prepare);
    const sign = vi.fn(owner.sign);
    if (phase === "prepare") prepare.mockRejectedValueOnce(new Error("private host failure"));
    else sign.mockRejectedValueOnce(new Error("private host failure"));
    const document = await openDocument({
      bytes,
      mode: "draft",
      model: model(),
      system: { ...profile, prepare },
      signer: { ...owner, sign },
    });
    value(await document.dispatch("set", set("retry", "saved intent")));
    const staged = document.draft();
    const state = document.state();
    expect(await document.commit()).toMatchObject(
      failure(phase === "prepare" ? "SYSTEM_FAILED" : "SIGNING_FAILED"),
    );
    expect(document.export()).toEqual(bytes);
    expect(document.state()).toEqual(state);
    expect(document.draft()).toEqual(staged);
    if (phase === "prepare") expect(sign).not.toHaveBeenCalled();
    value(await document.commit());
    expect(document.draft()).toBeNull();
    expect(document.state()).toMatchObject({ projection: { values: { retry: "saved intent" } } });
  }
});

test("candidate authentication failure and late model rejection never publish or discard the draft", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  for (const phase of ["authentication", "model"] as const) {
    let reject = false;
    const definition = model();
    const reduce = definition.reduce;
    definition.reduce = (state, event, facts) =>
      reject && phase === "model" ? issue("CANDIDATE_REJECTED") : reduce(state, event, facts);
    const profile = createStandardSystemProfile();
    const system = {
      ...profile,
      async prepare(input: Parameters<typeof profile.prepare>[0]) {
        const prepared = await profile.prepare(input);
        if (!prepared.ok || !reject || phase !== "authentication") return prepared;
        const entries = prepared.value.map((entry) => structuredClone(entry));
        for (const entry of entries)
          if (entry.kind === "application") entry.payload.ciphertext = "AA";
        return { ok: true as const, value: entries };
      },
    };
    const document = await openDocument({
      bytes,
      signer: owner,
      mode: "draft",
      model: definition,
      system,
    });
    value(await document.dispatch("set", set("atomic", "only after complete replay")));
    const draft = document.draft();
    const beforeState = document.state();
    reject = true;
    expect(await document.commit()).toMatchObject(
      failure(phase === "authentication" ? "DECRYPTION_INVALID" : "MODEL_TRANSITION_INVALID"),
    );
    expect(document.export()).toEqual(bytes);
    expect(document.state()).toEqual(beforeState);
    expect(document.draft()).toEqual(draft);
    reject = false;
    value(await document.commit());
    expect(document.draft()).toBeNull();
    expect(document.state()).toMatchObject({
      projection: { values: { atomic: "only after complete replay" } },
    });
  }
});

test("commit captures metadata before queueing and pending signing exposes committed reads only", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  let release!: () => void;
  let entering!: () => void;
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    entering = resolve;
  });
  const sign = vi.fn(async (message: Uint8Array) => {
    entering();
    await waiting;
    return owner.sign(message);
  });
  const document = await openDraft(bytes, { ...owner, sign });
  value(await document.dispatch("set", set("serial", "first")));
  const metadata: JsonObject = { label: "captured", nested: { revision: 1 } };
  const commit = document.commit(metadata);
  metadata.label = "mutated";
  (metadata.nested as JsonObject).revision = 2;
  await entered;
  const queued = document.dispatch("set", set("serial", "second"));
  expect(document.export()).toEqual(bytes);
  expect(document.state()).toMatchObject({ projection: { values: {}, order: [] } });
  expect(value(await document.replay()).projection).toEqual({ values: {}, order: [] });
  expect(document.inspect().entries).toEqual([]);
  expect(document.draft()!.preview.values.serial).toBe("first");
  release();
  const receipt = value(await commit);
  expect(value(await queued)).toMatchObject({
    status: "staged",
    baseHead: receipt.head,
    entryCount: 1,
  });
  expect(wire(document.export()).commits.at(-1)!.subject.metadata).toEqual({
    label: "captured",
    nested: { revision: 1 },
  });
  expect(document.state()).toMatchObject({ projection: { values: { serial: "first" } } });
  expect(document.draft()!.preview.values.serial).toBe("second");
  value(await document.commit());
  expect(sign).toHaveBeenCalledTimes(2);
  expect(document.state()).toMatchObject({ projection: { values: { serial: "second" } } });
});

test("model reentry is rejected during preview without deadlocking or staging its nested command", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  const definition = model();
  const decide = definition.commands.set.decide;
  let document!: DocumentHandle<State, Commands>;
  let nested: Promise<unknown> | undefined;
  definition.commands.set.decide = (input, state, context) => {
    nested = document.dispatch("set", set("nested", "must not stage"));
    return decide(input, state, context);
  };
  document = await openDraft(bytes, owner, definition);
  value(await document.dispatch("set", set("outer", "staged")));
  expect(await nested).toMatchObject(failure("HOST_CONFIGURATION"));
  expect(document.draft()!.entryCount).toBe(1);
  expect(document.draft()!.preview.values).toEqual({ outer: "staged" });
});

test("draft count, metadata and JSON depth limits fail atomically before signing", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  const sign = vi.fn(owner.sign);
  const document = await openDocument({
    bytes,
    signer: { ...owner, sign },
    mode: "draft",
    model: model(),
    system: createStandardSystemProfile(),
    limits: { maxEntries: 2, maxMetadataBytes: 32, maxDepth: 16 },
  });
  value(await document.dispatch("set", set("one", "within entry bound")));
  const before = document.draft();
  expect(await document.dispatch("set", set("two", "over entry bound"))).toMatchObject(
    failure("RESOURCE_LIMIT"),
  );
  expect(await document.commit({ oversized: "x".repeat(64) })).toMatchObject(
    failure("RESOURCE_LIMIT"),
  );
  let nested: JsonObject = {};
  for (let index = 0; index < 20; index++) nested = { nested };
  expect(
    await document.dispatch("set", { ...set("deep", "no publication"), nested } as Input),
  ).toMatchObject(failure("RESOURCE_LIMIT"));
  expect(document.draft()).toEqual(before);
  expect(document.export()).toEqual(bytes);
  expect(sign).not.toHaveBeenCalled();
  value(await document.commit({ note: "within bound" }));
  expect(sign).toHaveBeenCalledOnce();
});

test("candidate byte bounds preserve a valid preview and invalid metadata never runs getters", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  const sign = vi.fn(owner.sign);
  const document = await openDocument({
    bytes,
    signer: { ...owner, sign },
    mode: "draft",
    model: model(),
    system: createStandardSystemProfile(),
    limits: { maxBytes: bytes.length + 256 },
  });
  value(
    await document.dispatch("set", set("bounded", "candidate expands beyond available wire bytes")),
  );
  const before = document.draft();
  const getter = vi.fn(() => "do not evaluate host accessors");
  const metadata: JsonObject = {};
  Object.defineProperty(metadata, "secret", { enumerable: true, get: getter });
  expect(await document.commit(metadata)).toMatchObject(failure("SCHEMA_INVALID"));
  expect(getter).not.toHaveBeenCalled();
  expect(await document.commit()).toMatchObject(failure("RESOURCE_LIMIT"));
  expect(document.export()).toEqual(bytes);
  expect(document.draft()).toEqual(before);
  expect(sign).not.toHaveBeenCalled();
});

test("a null draft preview is passed to the next decision instead of the committed projection", async () => {
  type NullState = string | null;
  type NullCommands = { clear: {}; append: { value: string } };
  type NullEvent = { type: "draft.replace"; version: 1; data: { value: NullState } };
  const definition = defineModel<NullState, NullCommands, NullEvent>({
    ref: { id: "concord.test.null-draft", version: 1 },
    initial: () => "committed",
    commands: {
      clear: {
        validate: () => success({}),
        decide: () => success([{ type: "draft.replace", version: 1, data: { value: null } }]),
      },
      append: {
        validate: (input) =>
          input &&
          typeof input === "object" &&
          typeof (input as { value: unknown }).value === "string"
            ? success({ value: (input as { value: string }).value })
            : issue("INPUT_INVALID"),
        decide: (input, state) =>
          success([
            {
              type: "draft.replace",
              version: 1,
              data: { value: `${state === null ? "null" : "stale"}:${input.value}` },
            },
          ]),
      },
    },
    validateEvent: (input) => success(input as NullEvent),
    requirements: () => ["write"],
    reduce: (_state, event) => success(event.data.value),
  });
  const document = value(
    await createDocument({
      identity: await ownerIdentity(),
      model: definition,
      system: createStandardSystemProfile(),
      mode: "draft",
    }),
  );
  value(await document.dispatch("clear", {}));
  expect(document.draft()!.preview).toBeNull();
  value(await document.dispatch("append", { value: "next" }));
  expect(document.draft()).toMatchObject({ entryCount: 2, preview: "null:next" });
  expect(document.state()).toMatchObject({ projection: "committed" });
  value(await document.commit());
  expect(document.state()).toMatchObject({ projection: "null:next" });
});

test("prospective commit limits and invalid outer domain events fail before adding pending work", async () => {
  const owner = await ownerIdentity();
  const bytes = (await create(owner)).export();
  const sign = vi.fn(owner.sign);
  const limited = await openDocument({
    bytes,
    signer: { ...owner, sign },
    model: model(),
    system: createStandardSystemProfile(),
    mode: "draft",
    limits: { maxCommits: 1 },
  });
  expect(
    await limited.dispatch("set", set("blocked", "would require a second commit")),
  ).toMatchObject(failure("RESOURCE_LIMIT"));
  expect(limited.export()).toEqual(bytes);
  expect(limited.draft()).toBeNull();
  expect(sign).not.toHaveBeenCalled();

  const definition = model();
  const validateEvent = definition.validateEvent;
  let malformed = false;
  definition.validateEvent = (input) => {
    const result = validateEvent(input);
    return result.ok && malformed
      ? success({ ...result.value, version: 0 } as unknown as Event)
      : result;
  };
  const document = await openDraft(bytes, { ...owner, sign }, definition);
  value(await document.dispatch("set", set("kept", "valid pending input")));
  const before = document.draft();
  malformed = true;
  expect(await document.dispatch("set", set("bad", "invalid event envelope"))).toMatchObject(
    failure("EVENT_INVALID"),
  );
  expect(document.draft()).toEqual(before);
  expect(document.export()).toEqual(bytes);
  expect(sign).not.toHaveBeenCalled();
});

test("an independently authorized writer stages and commits against readable coverage without unlocking hidden audiences", async () => {
  const owner = await ownerIdentity();
  const writer = value(await identityFromSeed(new Uint8Array(32).fill(2)));
  const immediate = await create(owner);
  const own = value(await createGroup(immediate)).audience;
  const hidden = value(await createGroup(immediate)).audience;
  value(await immediate.dispatch("set", set("default", "default private content")));
  value(await immediate.dispatch("set", set("hidden", "hidden private content", hidden)));
  value(await immediate.dispatch("set", set("own", "visible history", own)));
  value(
    await setMember(immediate, {
      audience: own,
      identity: writer.publicIdentity,
      capabilities: ["read", "write"],
    }),
  );
  const definition = model();
  definition.reduceLocked = (state, entry) =>
    success({
      values: { ...state.values },
      order: [...state.order, `locked:${entry.audience}:${entry.epoch}`],
    });
  const document = await openDraft(immediate.export(), writer, definition);
  const before = document.export();
  expect(document.state()).toMatchObject({
    status: "ready",
    canWrite: true,
    coverage: "readable",
    lockedEntries: 2,
    projection: { values: { own: "visible history" } },
  });
  expect(
    document
      .inspect()
      .audiences!.find(({ audience }) => audience === "document")!
      .members.some(({ identity }) => identity.id === writer.publicIdentity.id),
  ).toBe(false);
  value(await document.dispatch("set", set("own", "staged independently", own)));
  const draft = document.draft()!;
  expect(draft.preview).toEqual({
    values: { own: "staged independently" },
    order: [
      "locked:document:0",
      `locked:${hidden}:0`,
      `${own}:visible history`,
      `${own}:staged independently`,
    ],
  });
  for (const audience of ["document", hidden] as const) {
    expect(
      await document.dispatch("set", set("denied", "cannot cross authority", audience)),
    ).toMatchObject(failure("CAPABILITY_DENIED"));
    expect(document.draft()).toEqual(draft);
    expect(document.export()).toEqual(before);
  }
  value(await document.commit());
  expect(document.draft()).toBeNull();
  expect(document.state()).toMatchObject({
    projection: draft.preview,
    coverage: "readable",
    lockedEntries: 2,
    canWrite: true,
  });
  expect(value(await document.replay())).toEqual({
    projection: draft.preview,
    coverage: "readable",
    lockedEntries: 2,
  });
  expect(document.inspect()).toMatchObject({ application: "scoped", lockedEntries: 2 });
  expect(document.inspect().entries!.map(({ status }) => status)).toEqual([
    "locked",
    "locked",
    "readable",
    "readable",
  ]);
});

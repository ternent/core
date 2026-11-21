import { createHash } from "node:crypto";
import { expect, test, vi } from "vite-plus/test";
import { identityFromSeed, type IdentityCapability } from "@ternent/armour";
import {
  createDocument,
  defineModel,
  openDocument,
  type ApplicationModel,
  type AudienceId,
  type CommitSubject,
  type EntrySubject,
  type ModelIssue,
  type ProjectionResult,
  type Result,
  type Snapshot,
} from "../src/index.js";
import { verifyDocument } from "../src/protocol/index.js";
import {
  createGroup,
  createStandardSystemProfile,
  removeMember,
  setMember,
} from "../src/system/index.js";
import { base64, encoded, hash, referenceSignature, seed, vector } from "./fixtures.js";

type Input = { audience: string; key: string; value: string; admin: boolean };
type Commands = { put: Input; cross: Input & { other: string } };
type Event = { type: "group.value"; version: 1; data: Input };
type State = { values: Record<string, string>; locked: string[]; actors: string[] };
type Model = ApplicationModel<State, Commands, Event>;

const success = <T>(value: T): Result<T, ModelIssue> => ({ ok: true, value });
const failure = (code: string) => ({ ok: false, error: { code } });
function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const identitySeed = (number: number) => new Uint8Array(32).fill(number);
const identity = async (number: number) => value(await identityFromSeed(identitySeed(number)));
const ownerIdentity = async () => value(await identityFromSeed(seed));
const wire = (bytes: Uint8Array): Snapshot =>
  JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
const put = (audience: AudienceId, key: string, text: string, admin = false): Input => ({
  audience,
  key,
  value: text,
  admin,
});

function input(candidate: unknown): Result<Input, ModelIssue> {
  if (!candidate || typeof candidate !== "object")
    return { ok: false, error: { code: "INPUT_INVALID", message: "Expected group input" } };
  const record = candidate as Record<string, unknown>;
  if (
    typeof record.audience !== "string" ||
    typeof record.key !== "string" ||
    typeof record.value !== "string" ||
    typeof record.admin !== "boolean"
  )
    return { ok: false, error: { code: "INPUT_INVALID", message: "Expected group fields" } };
  return success({
    audience: record.audience,
    key: record.key,
    value: record.value,
    admin: record.admin,
  });
}

function mapModel(scoped = true): Model {
  return defineModel<State, Commands, Event>({
    ref: { id: "concord.test.independent-groups", version: 1 },
    initial: () => ({ values: {}, locked: [], actors: [] }),
    commands: {
      put: {
        validate: input,
        audience: (selected) => selected.audience as AudienceId,
        decide: (selected) => success([{ type: "group.value", version: 1, data: selected }]),
      },
      cross: {
        validate(candidate) {
          const checked = input(candidate);
          if (!checked.ok) return checked;
          if (typeof (candidate as Record<string, unknown>).other !== "string")
            return { ok: false, error: { code: "INPUT_INVALID", message: "Missing audience" } };
          return success({ ...checked.value, other: (candidate as { other: string }).other });
        },
        audience: (selected) => selected.audience as AudienceId,
        decide: ({ other, ...selected }) =>
          success([
            { type: "group.value", version: 1, data: selected },
            { type: "group.value", version: 1, data: { ...selected, audience: other } },
          ]),
      },
    },
    validateEvent(candidate) {
      if (!candidate || typeof candidate !== "object")
        return { ok: false, error: { code: "EVENT_INVALID", message: "Expected an event" } };
      const event = candidate as Record<string, unknown>;
      const checked = input(event.data);
      if (event.type !== "group.value" || event.version !== 1 || !checked.ok)
        return { ok: false, error: { code: "EVENT_INVALID", message: "Invalid group event" } };
      return success({ type: "group.value", version: 1, data: checked.value });
    },
    audience: (event) => event.data.audience as AudienceId,
    requirements: (event) => (event.data.admin ? ["administer"] : ["write"]),
    reduce: (state, event, facts) =>
      success({
        values: { ...state.values, [event.data.key]: event.data.value },
        locked: [...state.locked],
        actors: [...state.actors, `${facts.audience}:${facts.actor.id}`],
      }),
    ...(scoped
      ? {
          reduceLocked: (state: Readonly<State>, entry: { audience: AudienceId; epoch: number }) =>
            success({
              values: { ...state.values },
              locked: [...state.locked, `${entry.audience}:${entry.epoch}`],
              actors: [...state.actors],
            }),
        }
      : {}),
  });
}

const create = async (owner: IdentityCapability, model = mapModel()) =>
  value(await createDocument({ identity: owner, model, system: createStandardSystemProfile() }));
const open = (bytes: Uint8Array, signer?: IdentityCapability, model = mapModel()) =>
  openDocument({ bytes, signer, model, system: createStandardSystemProfile() });

function append(
  bytes: Uint8Array,
  subject: EntrySubject,
  signer: IdentityCapability,
  signerSeed: Uint8Array,
): Uint8Array {
  const snapshot = wire(bytes);
  subject.parent = snapshot.head;
  const entry = { id: hash(subject, "entry"), subject };
  const commit: CommitSubject = {
    version: 1,
    suite: "concord-25519-age-v1",
    parent: snapshot.head,
    nonce: base64(new Uint8Array(16).fill(101)),
    signer: signer.publicIdentity,
    declaration: null,
    entryIds: [entry.id],
    metadata: null,
  };
  snapshot.head = hash(commit, "commit");
  snapshot.commits.push({
    id: snapshot.head,
    subject: commit,
    signature: referenceSignature(commit, signerSeed),
  });
  snapshot.entries.push(entry);
  return encoded(snapshot);
}

test("G01-G04 writers create independent groups and owners cannot grant themselves access", async () => {
  const [owner, writer, outsider] = await Promise.all([ownerIdentity(), identity(2), identity(3)]);
  const document = await create(owner);
  value(await document.dispatch("put", put("document", "default", "default history")));
  value(
    await setMember(document, { identity: writer.publicIdentity, capabilities: ["read", "write"] }),
  );
  const authored = await open(document.export(), writer);
  const accounts = value(await createGroup(authored)).audience;
  const notes = value(await createGroup(authored)).audience;
  expect(accounts).not.toBe(notes);
  value(await authored.dispatch("put", put(accounts, "accounts", "accounts history")));
  value(await authored.dispatch("put", put(notes, "notes", "private notes")));
  value(
    await setMember(authored, {
      audience: accounts,
      identity: outsider.publicIdentity,
      capabilities: ["read", "write"],
    }),
  );

  const ownerView = await open(authored.export(), owner);
  expect(ownerView.state()).toMatchObject({
    status: "ready",
    coverage: "readable",
    lockedEntries: 2,
    projection: { values: { default: "default history" } },
  });
  const saved = ownerView.export();
  expect(
    await setMember(ownerView, {
      audience: accounts,
      identity: owner.publicIdentity,
      capabilities: ["read", "write", "grant", "administer"],
    }),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  expect(ownerView.export()).toEqual(saved);

  const member = await open(authored.export(), outsider);
  expect(member.state()).toMatchObject({
    status: "ready",
    canWrite: true,
    coverage: "readable",
    lockedEntries: 2,
    projection: { values: { accounts: "accounts history" } },
  });
  const audiences = member.inspect().audiences!;
  expect(
    audiences
      .find(({ audience }) => audience === "document")!
      .members.some(({ identity: enrolled }) => enrolled.id === outsider.publicIdentity.id),
  ).toBe(false);
  expect(await createGroup(member)).toMatchObject(failure("CAPABILITY_DENIED"));
  value(await member.dispatch("put", put(accounts, "accounts", "outsider can contribute")));
  expect((await open(member.export(), writer)).state()).toMatchObject({
    projection: { values: { accounts: "outsider can contribute", notes: "private notes" } },
  });
});

test("G05 default membership removal preserves independent group write and keys", async () => {
  const [owner, writer] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  value(
    await setMember(document, { identity: writer.publicIdentity, capabilities: ["read", "write"] }),
  );
  const writerView = await open(document.export(), writer);
  const group = value(await createGroup(writerView)).audience;
  value(await writerView.dispatch("put", put(group, "group", "before default removal")));
  const adminView = await open(writerView.export(), owner);
  value(await removeMember(adminView, { identityId: writer.publicIdentity.id }));
  value(await adminView.dispatch("put", put("document", "default", "new default epoch")));

  const removed = await open(adminView.export(), writer);
  expect(removed.state()).toMatchObject({ status: "ready", canWrite: true, lockedEntries: 1 });
  expect(
    removed.inspect().audiences!.find(({ audience }) => audience === group)!.epochs,
  ).toHaveLength(1);
  expect(await removed.dispatch("put", put("document", "default", "denied"))).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  expect(await createGroup(removed)).toMatchObject(failure("CAPABILITY_DENIED"));
  value(await removed.dispatch("put", put(group, "group", "still independently authorized")));
  expect(removed.state()).toMatchObject({
    projection: { values: { group: "still independently authorized" } },
  });
});

test("G06-G09 removal rotates only its group and readmission grants every saved epoch", async () => {
  const [owner, member] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const accounts = value(await createGroup(document)).audience;
  const notes = value(await createGroup(document)).audience;
  for (const audience of [accounts, notes]) {
    value(
      await setMember(document, {
        audience,
        identity: member.publicIdentity,
        capabilities: ["read", "write"],
      }),
    );
  }
  value(await document.dispatch("put", put(accounts, "old", "historical plaintext")));
  value(await removeMember(document, { audience: accounts, identityId: member.publicIdentity.id }));
  value(await document.dispatch("put", put(accounts, "new", "future account plaintext")));
  value(await document.dispatch("put", put(notes, "notes", "independent plaintext")));
  const saved = document.export();
  const removed = await open(saved, member);
  expect(removed.state()).toMatchObject({
    status: "ready",
    coverage: "readable",
    canWrite: true,
    lockedEntries: 1,
    projection: { values: { old: "historical plaintext", notes: "independent plaintext" } },
  });
  const current = removed.inspect().audiences!;
  expect(
    current.find(({ audience }) => audience === accounts)!.epochs.map(({ epoch }) => epoch),
  ).toEqual([0, 1]);
  expect(
    current.find(({ audience }) => audience === notes)!.epochs.map(({ epoch }) => epoch),
  ).toEqual([0]);
  expect(
    current.find(({ audience }) => audience === "document")!.epochs.map(({ epoch }) => epoch),
  ).toEqual([0]);
  expect(await removed.dispatch("put", put(accounts, "denied", "denied"))).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  value(await removed.dispatch("put", put(notes, "notes", "notes remain writable")));

  value(
    await setMember(document, {
      audience: accounts,
      identity: member.publicIdentity,
      capabilities: ["read", "write"],
    }),
  );
  const last = wire(document.export()).entries.at(-1)!.subject;
  expect(last.payload).toMatchObject({
    type: "system.member.set",
    data: { audience: accounts, history: [{ epoch: 0 }, { epoch: 1 }] },
  });
  const readmitted = await open(document.export(), member);
  expect(readmitted.state()).toMatchObject({
    status: "ready",
    coverage: "complete",
    lockedEntries: 0,
    projection: {
      values: {
        old: "historical plaintext",
        new: "future account plaintext",
        notes: "independent plaintext",
      },
    },
  });
  expect((await open(saved, member)).state()).toMatchObject({
    coverage: "readable",
    lockedEntries: 1,
  });
});

test("G10 identical saved bytes replay deterministically with explicit coverage and ordered markers", async () => {
  const [owner, reader] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  value(await setMember(document, { identity: reader.publicIdentity, capabilities: ["read"] }));
  const hidden = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put("document", "first", "visible first")));
  value(await document.dispatch("put", put(hidden, "secret", "not readable")));
  value(await document.dispatch("put", put("document", "last", "visible last")));
  const saved = document.export();
  const first = await open(saved, reader);
  const second = await open(saved, reader);
  const firstReplay = value(await first.replay());
  expect(firstReplay).toEqual(value(await second.replay()));
  expect(firstReplay).toMatchObject({
    coverage: "readable",
    lockedEntries: 1,
    projection: {
      values: { first: "visible first", last: "visible last" },
      locked: [`${hidden}:0`],
      actors: [`document:${owner.publicIdentity.id}`, `document:${owner.publicIdentity.id}`],
    },
  });
  expect(first.state()).toMatchObject(firstReplay);
  expect(first.inspect()).toMatchObject({
    system: "valid",
    application: "scoped",
    lockedEntries: 1,
  });
  expect(first.inspect().entries!.map(({ status }) => status)).toEqual([
    "readable",
    "locked",
    "readable",
  ]);
  expect(first.inspect().entries!.map(({ entryId }) => entryId)).toEqual(
    wire(saved)
      .entries.filter(({ subject }) => subject.kind === "application")
      .map(({ id }) => id),
  );
  const marker = first.inspect().entries![1];
  expect(marker.facts.audience).toBe(hidden);
  expect(marker.facts.actor.id).toBe(owner.publicIdentity.id);
  expect("event" in marker).toBe(false);
  expect(first.export()).toEqual(saved);
});

test("G11 full models stop before callbacks while opted-in models expose locked read-only coverage", async () => {
  const [owner, outsider] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  value(await document.dispatch("put", put("document", "secret", "private")));
  const model = mapModel(false);
  model.initial = vi.fn(model.initial);
  model.reduce = vi.fn(model.reduce);
  const full = await open(document.export(), outsider, model);
  expect(full.state()).toEqual({ status: "inspection", reason: "locked" });
  expect(model.initial).not.toHaveBeenCalled();
  expect(model.reduce).not.toHaveBeenCalled();
  expect(full.inspect().entries).toMatchObject([
    { status: "locked", audience: "document", epoch: 0 },
  ]);

  const scoped = await open(document.export(), outsider);
  expect(scoped.state()).toMatchObject({
    status: "ready",
    coverage: "readable",
    lockedEntries: 1,
    canWrite: false,
    projection: { values: {}, locked: ["document:0"] },
  });
  expect(await scoped.dispatch("put", put("document", "secret", "denied"))).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  const unsigned = await open(document.export());
  expect(unsigned.state()).toMatchObject({
    status: "ready",
    coverage: "readable",
    lockedEntries: 1,
    canWrite: false,
  });
  expect(await unsigned.dispatch("put", put("document", "secret", "denied"))).toMatchObject(
    failure("READ_ONLY_RUNTIME"),
  );
});

test("G12 a command cannot cross audiences or bypass model capabilities and failures are atomic", async () => {
  const [owner, writer] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const left = value(await createGroup(document)).audience;
  const right = value(await createGroup(document)).audience;
  value(
    await setMember(document, {
      audience: left,
      identity: writer.publicIdentity,
      capabilities: ["read", "write"],
    }),
  );
  const before = document.export();
  const state = document.state();
  expect(
    await document.dispatch("cross", { ...put(left, "cross", "must be atomic"), other: right }),
  ).toMatchObject(failure("EVENT_INVALID"));
  expect(document.export()).toEqual(before);
  expect(document.state()).toEqual(state);
  const writerView = await open(before, writer);
  expect(await writerView.dispatch("put", put(left, "admin", "denied", true))).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  expect(writerView.export()).toEqual(before);
  value(await writerView.dispatch("put", put(left, "allowed", "group writer")));
});

test("G13 rejected locked-model passes keep readable evidence without publishing a projection", async () => {
  const [owner, reader] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  value(await setMember(document, { identity: reader.publicIdentity, capabilities: ["read"] }));
  value(await document.dispatch("put", put("document", "visible", "inspectable evidence")));
  const hidden = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put(hidden, "hidden", "hidden transition")));
  const model = mapModel();
  model.reduceLocked = () => ({
    ok: false,
    error: { code: "LOCKED_DEPENDENCY", message: "Missing model dependency" },
  });
  const rejected = await open(document.export(), reader, model);
  expect(rejected.state()).toEqual({ status: "inspection", reason: "invalid" });
  expect(rejected.inspect()).toMatchObject({ system: "valid", application: "invalid" });
  expect(rejected.inspect().entries).toMatchObject([
    { status: "readable", event: { data: { value: "inspectable evidence" } } },
    { status: "locked", audience: hidden },
  ]);
  expect(rejected.export()).toEqual(document.export());
});

test("G14 hidden-group authority is checked before any reader decryption or model callbacks", async () => {
  const [owner, writer, target] = await Promise.all([ownerIdentity(), identity(2), identity(3)]);
  const document = await create(owner);
  value(
    await setMember(document, { identity: writer.publicIdentity, capabilities: ["read", "write"] }),
  );
  const creator = await open(document.export(), writer);
  const group = value(await createGroup(creator)).audience;
  const before = creator.export();
  value(
    await setMember(creator, {
      audience: group,
      identity: target.publicIdentity,
      capabilities: ["read"],
    }),
  );
  const grant = wire(creator.export()).entries.at(-1)!.subject;
  const forged = append(before, grant, owner, seed);
  expect((await verifyDocument(forged)).integrity).toBe("valid");
  const model = mapModel();
  model.initial = vi.fn(model.initial);
  model.reduce = vi.fn(model.reduce);
  const decryptAge = vi.fn(owner.decryptAge);
  const inspected = await openDocument({
    bytes: forged,
    model,
    system: createStandardSystemProfile(),
    reader: { publicIdentity: owner.publicIdentity, decryptAge },
  });
  expect(inspected.inspect().findings).toMatchObject([{ code: "CAPABILITY_DENIED" }]);
  expect(inspected.inspect().entries).toBeNull();
  expect(decryptAge).not.toHaveBeenCalled();
  expect(model.initial).not.toHaveBeenCalled();
  expect(model.reduce).not.toHaveBeenCalled();
});

test("G15 ciphertext cannot be substituted between independently keyed groups", async () => {
  const owner = await ownerIdentity();
  const document = await create(owner);
  const first = value(await createGroup(document)).audience;
  const second = value(await createGroup(document)).audience;
  const before = document.export();
  value(await document.dispatch("put", put(first, "secret", "bound to first group")));
  const entry = wire(document.export()).entries.at(-1)!.subject;
  if (entry.kind !== "application") throw new Error("Expected application entry");
  entry.payload.audience = second;
  const substituted = append(before, entry, owner, seed);
  expect((await verifyDocument(substituted)).integrity).toBe("valid");
  const model = mapModel();
  model.initial = vi.fn(model.initial);
  model.reduce = vi.fn(model.reduce);
  const inspected = await open(substituted, owner, model);
  expect(inspected.inspect().findings).toMatchObject([{ code: "DECRYPTION_INVALID" }]);
  expect(inspected.inspect().entries).toBeNull();
  expect(model.initial).not.toHaveBeenCalled();
  expect(model.reduce).not.toHaveBeenCalled();
});

test("G16 protocol tampering never reaches either model replay path", async () => {
  const owner = await ownerIdentity();
  const document = await create(owner);
  const group = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put(group, "private", "untampered")));
  const corrupt = wire(document.export());
  const entry = corrupt.entries.at(-1)!.subject;
  if (entry.kind !== "application") throw new Error("Expected application entry");
  entry.payload.ciphertext = "AA";
  const model = mapModel();
  model.initial = vi.fn(model.initial);
  model.reduce = vi.fn(model.reduce);
  model.reduceLocked = vi.fn(model.reduceLocked!);
  const inspected = await open(encoded(corrupt), owner, model);
  expect(inspected.state()).toEqual({ status: "inspection", reason: "invalid" });
  expect(inspected.inspect().verification.integrity).toBe("invalid");
  expect(inspected.inspect().entries).toBeNull();
  expect(model.initial).not.toHaveBeenCalled();
  expect(model.reduce).not.toHaveBeenCalled();
  expect(model.reduceLocked).not.toHaveBeenCalled();
});

test("G17 readable event routing must match its signed audience during replay", async () => {
  const owner = await ownerIdentity();
  const document = await create(owner);
  const group = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put(group, "private", "group-bound event")));
  const model = mapModel();
  model.audience = () => "document";
  model.reduce = vi.fn(model.reduce);
  const inspected = await open(document.export(), owner, model);
  expect(inspected.state()).toEqual({ status: "inspection", reason: "invalid" });
  expect(inspected.inspect().findings).toMatchObject([{ code: "EVENT_INVALID" }]);
  expect(inspected.inspect().entries).toMatchObject([
    {
      status: "readable",
      facts: { audience: group },
      event: { data: { value: "group-bound event" } },
    },
  ]);
  expect(model.reduce).not.toHaveBeenCalled();
});

test("a group administrator without write can manage only that group and retains final-admin protection", async () => {
  const [owner, administrator, target] = await Promise.all([
    ownerIdentity(),
    identity(2),
    identity(3),
  ]);
  const document = await create(owner);
  const group = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put(group, "history", "administrator can inspect")));
  value(
    await setMember(document, {
      audience: group,
      identity: administrator.publicIdentity,
      capabilities: ["read", "administer"],
    }),
  );
  const admin = await open(document.export(), administrator);
  expect(admin.state()).toMatchObject({
    status: "ready",
    canWrite: false,
    coverage: "complete",
    projection: { values: { history: "administrator can inspect" } },
  });
  const before = admin.export();
  expect(await admin.dispatch("put", put(group, "denied", "no write capability"))).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  expect(
    await setMember(admin, {
      identity: target.publicIdentity,
      capabilities: ["read"],
    }),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  expect(admin.export()).toEqual(before);
  value(
    await setMember(admin, {
      audience: group,
      identity: target.publicIdentity,
      capabilities: ["read"],
    }),
  );
  value(await removeMember(admin, { audience: group, identityId: target.publicIdentity.id }));
  value(await removeMember(admin, { audience: group, identityId: owner.publicIdentity.id }));
  const soleAdmin = admin.export();
  expect(
    await setMember(admin, {
      audience: group,
      identity: administrator.publicIdentity,
      capabilities: ["read", "write"],
    }),
  ).toMatchObject(failure("LAST_ADMINISTRATOR"));
  expect(
    await removeMember(admin, { audience: group, identityId: administrator.publicIdentity.id }),
  ).toMatchObject(failure("LAST_ADMINISTRATOR"));
  expect(admin.export()).toEqual(soleAdmin);
  expect(
    admin.inspect().audiences!.find(({ audience }) => audience === "document")!.members,
  ).toMatchObject([{ identity: owner.publicIdentity }]);
});

test("command decisions receive selected-group facts and mixed routing stops before prepare or signing", async () => {
  const [owner, writer] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const selected = value(await createGroup(document)).audience;
  const other = value(await createGroup(document)).audience;
  value(
    await setMember(document, {
      identity: writer.publicIdentity,
      capabilities: ["read"],
    }),
  );
  value(
    await setMember(document, {
      audience: selected,
      identity: writer.publicIdentity,
      capabilities: ["read", "write"],
    }),
  );
  const model = mapModel();
  const decide = vi.fn(model.commands.cross.decide);
  model.commands.cross.decide = decide;
  const profile = createStandardSystemProfile();
  const prepare = vi.fn(profile.prepare);
  const system = { ...profile, prepare };
  const sign = vi.fn(writer.sign);
  const authored = await openDocument({
    bytes: document.export(),
    signer: { ...writer, sign },
    model,
    system,
  });
  const before = authored.export();
  const beforeState = authored.state();
  expect(
    await authored.dispatch("cross", {
      ...put(selected, "mixed", "must not publish"),
      other,
    }),
  ).toMatchObject(failure("EVENT_INVALID"));
  expect(decide).toHaveBeenCalledOnce();
  expect(decide.mock.calls[0][2].facts).toMatchObject({
    audience: selected,
    actor: writer.publicIdentity,
    capabilities: ["read", "write"],
  });
  expect(prepare).not.toHaveBeenCalled();
  expect(sign).not.toHaveBeenCalled();
  expect(authored.export()).toEqual(before);
  expect(authored.state()).toEqual(beforeState);
  value(await authored.dispatch("put", put(selected, "valid", "same group succeeds")));
  expect(prepare).toHaveBeenCalledOnce();
  expect(sign).toHaveBeenCalledOnce();
});

async function systemRejection(
  bytes: Uint8Array,
  reader: IdentityCapability,
  code: "SYSTEM_EVENT_INVALID" | "KEY_WRAP_INVALID",
  decrypts = false,
) {
  expect((await verifyDocument(bytes)).integrity).toBe("valid");
  const model = mapModel();
  model.initial = vi.fn(model.initial);
  model.reduce = vi.fn(model.reduce);
  model.reduceLocked = vi.fn(model.reduceLocked!);
  const decryptAge = vi.fn(reader.decryptAge);
  const inspected = await openDocument({
    bytes,
    model,
    system: createStandardSystemProfile(),
    reader: { publicIdentity: reader.publicIdentity, decryptAge },
  });
  expect(inspected.state()).toEqual({ status: "inspection", reason: "invalid" });
  expect(inspected.inspect().findings).toMatchObject([{ code }]);
  expect(inspected.inspect().entries).toBeNull();
  if (decrypts) expect(decryptAge).toHaveBeenCalled();
  else expect(decryptAge).not.toHaveBeenCalled();
  expect(model.initial).not.toHaveBeenCalled();
  expect(model.reduce).not.toHaveBeenCalled();
  expect(model.reduceLocked).not.toHaveBeenCalled();
}

function systemEntry(bytes: Uint8Array): Extract<EntrySubject, { kind: "system" }> {
  const entry = wire(bytes).entries.at(-1)!.subject;
  if (entry.kind !== "system") throw new Error("Expected system entry");
  return entry;
}

const unusedGroup = `group:${base64(new Uint8Array(16).fill(99))}` as const;

test("re-signed group creation and membership reject duplicate, unknown, noncanonical and open shapes", async () => {
  const [owner, newcomer] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const beforeCreation = document.export();
  const created = value(await createGroup(document)).audience;
  const creation = systemEntry(document.export());
  const afterCreation = document.export();
  await systemRejection(
    append(afterCreation, structuredClone(creation), owner, seed),
    owner,
    "SYSTEM_EVENT_INVALID",
  );

  for (const change of [
    (entry: typeof creation) => {
      entry.payload.data.label = "must remain encrypted";
    },
    (entry: typeof creation) => {
      entry.payload.data.audience = "group:noncanonical";
    },
    (entry: typeof creation) => {
      entry.payload.data.audience = `group:${"A".repeat(21)}B`;
    },
    (entry: typeof creation) => {
      entry.payload.data.audience = "document";
    },
    (entry: typeof creation) => {
      entry.payload.data.epoch = 1;
    },
  ]) {
    const altered = structuredClone(creation);
    change(altered);
    await systemRejection(
      append(beforeCreation, altered, owner, seed),
      owner,
      "SYSTEM_EVENT_INVALID",
    );
  }

  value(
    await setMember(document, {
      audience: created,
      identity: newcomer.publicIdentity,
      capabilities: ["read"],
    }),
  );
  const admission = systemEntry(document.export());
  for (const audience of [unusedGroup, "group:noncanonical"]) {
    const altered = structuredClone(admission);
    altered.payload.data.audience = audience;
    await systemRejection(
      append(afterCreation, altered, owner, seed),
      owner,
      "SYSTEM_EVENT_INVALID",
    );
  }
});

test("re-signed create and rotation reject recipient reuse across every audience", async () => {
  const [owner, member] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const defaultRecipient = systemEntry(document.export()).payload.data.recipient;
  const first = value(await createGroup(document)).audience;
  const firstRecipient = systemEntry(document.export()).payload.data.recipient;
  const beforeSecond = document.export();
  const second = value(await createGroup(document)).audience;
  const secondCreation = systemEntry(document.export());
  for (const recipient of [defaultRecipient, firstRecipient]) {
    const altered = structuredClone(secondCreation);
    altered.payload.data.recipient = recipient;
    await systemRejection(
      append(beforeSecond, altered, owner, seed),
      owner,
      "SYSTEM_EVENT_INVALID",
    );
  }

  value(
    await setMember(document, {
      audience: first,
      identity: member.publicIdentity,
      capabilities: ["read"],
    }),
  );
  const beforeRotation = document.export();
  value(await removeMember(document, { audience: first, identityId: member.publicIdentity.id }));
  const rotation = systemEntry(document.export());
  const secondRecipient = document.inspect().audiences!.find(({ audience }) => audience === second)!
    .epochs[0].recipient;
  for (const recipient of [defaultRecipient, firstRecipient, secondRecipient]) {
    const altered = structuredClone(rotation);
    altered.payload.data.recipient = recipient;
    await systemRejection(
      append(beforeRotation, altered, owner, seed),
      owner,
      "SYSTEM_EVENT_INVALID",
    );
  }
});

test("addressed key wraps cannot be substituted across otherwise valid group creation envelopes", async () => {
  const owner = await ownerIdentity();
  const document = await create(owner);
  value(await createGroup(document));
  const first = systemEntry(document.export());
  const beforeSecond = document.export();
  value(await createGroup(document));
  const substituted = systemEntry(document.export());
  const firstWrap = (first.payload.data.wraps as { identityId: string; ciphertext: string }[])[0];
  const secondWrap = (
    substituted.payload.data.wraps as { identityId: string; ciphertext: string }[]
  )[0];
  expect(firstWrap.identityId).toBe(secondWrap.identityId);
  secondWrap.ciphertext = firstWrap.ciphertext;
  await systemRejection(
    append(beforeSecond, substituted, owner, seed),
    owner,
    "KEY_WRAP_INVALID",
    true,
  );
});

test("custom profiles cannot omit, duplicate, reorder, misroute or inject payloads into locked entries", async () => {
  const [owner, outsider] = await Promise.all([ownerIdentity(), identity(2)]);
  const document = await create(owner);
  const group = value(await createGroup(document)).audience;
  value(await document.dispatch("put", put("document", "first", "default private event")));
  value(await document.dispatch("put", put(group, "second", "group private event")));
  const profile = createStandardSystemProfile();
  type Items = import("../src/system/index.js").ReplayItem[];
  const mutations: ((entries: Items) => void)[] = [
    (entries) => {
      entries.pop();
    },
    (entries) => {
      entries[1] = entries[0];
    },
    (entries) => {
      entries.reverse();
    },
    (entries) => {
      if (entries[0].status !== "locked") throw new Error("Expected locked entry");
      entries[0].audience = group;
    },
    (entries) => {
      entries[0].facts.audience = group;
    },
    (entries) => {
      Object.assign(entries[0], {
        event: {
          type: "group.value",
          version: 1,
          data: put("document", "invented", "fabricated plaintext"),
        },
      });
    },
  ];
  for (const mutate of mutations) {
    const model = mapModel();
    model.initial = vi.fn(model.initial);
    model.reduce = vi.fn(model.reduce);
    model.reduceLocked = vi.fn(model.reduceLocked!);
    const altered = {
      ...profile,
      async replay(input: Parameters<typeof profile.replay>[0]) {
        const result = await profile.replay(input);
        if (!result.ok) return result;
        const entries = result.value.entries.map((item) => structuredClone(item));
        expect(entries.every(({ status }) => status === "locked")).toBe(true);
        mutate(entries);
        return { ok: true as const, value: { ...result.value, entries } };
      },
    };
    const inspected = await openDocument({
      bytes: document.export(),
      model,
      system: altered,
      reader: outsider,
    });
    expect(inspected.inspect().verification.integrity).toBe("valid");
    expect(inspected.inspect().findings).toMatchObject([{ code: "SYSTEM_FAILED" }]);
    expect(inspected.inspect().entries).toBeNull();
    expect(inspected.state()).toEqual({ status: "inspection", reason: "invalid" });
    expect(model.initial).not.toHaveBeenCalled();
    expect(model.reduce).not.toHaveBeenCalled();
    expect(model.reduceLocked).not.toHaveBeenCalled();
  }
});

test("fixed signed group vectors replay the same saved history for each reader and admission stage", async () => {
  type Reader = "owner" | "creator" | "bob";
  type Stage = "removed" | "readmitted";
  const expected = vector<{
    audiences: { accounts: AudienceId; personal: AudienceId };
    readers: Record<Reader, Record<Stage, ProjectionResult<State>>>;
    canWrite: Record<Reader, boolean>;
    canonicalSha256: Record<Stage, string>;
    heads: Record<Stage, string>;
    documentId: string;
  }>("groups.expected");
  const readers = {
    owner: await ownerIdentity(),
    creator: await identity(2),
    bob: await identity(3),
  };
  for (const stage of ["removed", "readmitted"] as const) {
    const bytes = encoded(vector<Snapshot>(`groups.${stage}.document`));
    expect((await verifyDocument(bytes)).integrity).toBe("valid");
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(expected.canonicalSha256[stage]);
    expect(wire(bytes).head).toBe(expected.heads[stage]);
    expect(wire(bytes).documentId).toBe(expected.documentId);
    for (const name of ["owner", "creator", "bob"] as const) {
      const first = await open(bytes, readers[name]);
      const second = await open(bytes, readers[name]);
      const projection = expected.readers[name][stage];
      expect(value(await first.replay())).toEqual(projection);
      expect(value(await second.replay())).toEqual(projection);
      const state = {
        status: "ready",
        documentId: expected.documentId,
        head: expected.heads[stage],
        canWrite: expected.canWrite[name],
        ...projection,
      };
      expect(first.state()).toEqual(state);
      expect(second.state()).toEqual(state);
      expect(first.inspect()).toMatchObject({
        system: "valid",
        application: projection.coverage === "complete" ? "valid" : "scoped",
        lockedEntries: projection.lockedEntries,
      });
      expect(
        first
          .inspect()
          .audiences!.map(({ audience }) => audience)
          .sort(),
      ).toEqual(["document", expected.audiences.accounts, expected.audiences.personal].sort());
      expect(first.export()).toEqual(bytes);
      expect(second.export()).toEqual(bytes);
    }
  }
});

test("nested profile security records are closed and validated before inspection or model publication", async () => {
  type Replay = import("../src/system/index.js").SystemReplay;
  const owner = await ownerIdentity();
  const bytes = encoded(vector<Snapshot>("groups.readmitted.document"));
  const expected = vector<{ audiences: { accounts: AudienceId } }>("groups.expected");
  const profile = createStandardSystemProfile();
  const accounts = (output: Replay) =>
    output.audiences.find(({ audience }) => audience === expected.audiences.accounts)!;
  const historical = (output: Replay) =>
    output.entryFacts.find(
      ({ facts }) => facts.audience === expected.audiences.accounts && facts.members.length > 1,
    )!.facts;
  const cases: [string, (output: Replay) => void][] = [
    [
      "secret in an epoch",
      (output) => {
        Object.assign(accounts(output).epochs[0], { secret: "must stay private" });
      },
    ],
    [
      "secret in a current member",
      (output) => {
        Object.assign(accounts(output).members[0], { secret: "must stay private" });
      },
    ],
    [
      "secret in a historical member",
      (output) => {
        Object.assign(historical(output).members[0], { secret: "must stay private" });
      },
    ],
    [
      "extra field in public identity",
      (output) => {
        Object.assign(accounts(output).members[0].identity, { secret: "must stay private" });
      },
    ],
    [
      "member identity does not bind its key",
      (output) => {
        Object.assign(accounts(output).members[0].identity, { id: `identity:${"0".repeat(64)}` });
      },
    ],
    [
      "historical identity does not bind its key",
      (output) => {
        Object.assign(historical(output).members[0].identity, { id: `identity:${"0".repeat(64)}` });
      },
    ],
    [
      "member identity has an invalid point",
      (output) => {
        Object.assign(accounts(output).members[0].identity, {
          publicKey: base64(new Uint8Array(32)),
        });
      },
    ],
    [
      "unknown member capability",
      (output) => {
        Object.assign(accounts(output).members[0], { capabilities: ["read", "imaginary"] });
      },
    ],
    [
      "noncanonical member capabilities",
      (output) => {
        Object.assign(accounts(output).members[0], { capabilities: ["write", "read"] });
      },
    ],
    [
      "duplicate member capabilities",
      (output) => {
        Object.assign(accounts(output).members[0], { capabilities: ["read", "read"] });
      },
    ],
    [
      "member capabilities omit read",
      (output) => {
        Object.assign(accounts(output).members[0], { capabilities: ["write"] });
      },
    ],
    [
      "noncanonical historical member capabilities",
      (output) => {
        Object.assign(historical(output).members[0], { capabilities: ["write", "read"] });
      },
    ],
    [
      "noncanonical actor capabilities",
      (output) => {
        historical(output).capabilities = ["write", "read"];
      },
    ],
    [
      "duplicate current members",
      (output) => {
        const group = accounts(output);
        group.members = [...group.members, group.members[0]];
      },
    ],
    [
      "unsorted current members",
      (output) => {
        const group = accounts(output);
        group.members = [...group.members].reverse();
      },
    ],
    [
      "duplicate historical members",
      (output) => {
        const facts = historical(output);
        facts.members = [...facts.members, facts.members[0]];
      },
    ],
    [
      "unsorted historical members",
      (output) => {
        const facts = historical(output);
        facts.members = [...facts.members].reverse();
      },
    ],
    [
      "invalid recipient",
      (output) => {
        accounts(output).epochs[0].recipient = "age1invalid";
      },
    ],
    [
      "empty epoch sequence",
      (output) => {
        accounts(output).epochs = [];
      },
    ],
    [
      "epoch gap",
      (output) => {
        accounts(output).epochs[1].epoch = 9;
      },
    ],
    [
      "negative epoch",
      (output) => {
        accounts(output).epochs[0].epoch = -1;
      },
    ],
    [
      "fractional epoch",
      (output) => {
        accounts(output).epochs[0].epoch = 0.5;
      },
    ],
    [
      "duplicate epochs",
      (output) => {
        accounts(output).epochs[1].epoch = 0;
      },
    ],
    [
      "unsorted epochs",
      (output) => {
        const group = accounts(output);
        group.epochs = [...group.epochs].reverse();
      },
    ],
  ];
  for (const [name, mutate] of cases) {
    const model = mapModel();
    model.initial = vi.fn(model.initial);
    model.reduce = vi.fn(model.reduce);
    model.reduceLocked = vi.fn(model.reduceLocked!);
    const system = {
      ...profile,
      async replay(input: Parameters<typeof profile.replay>[0]) {
        const result = await profile.replay(input);
        if (!result.ok) return result;
        const output = { ...structuredClone(result.value), session: result.value.session };
        mutate(output);
        // Keep matching entry facts coherent so each failure exercises the nested boundary.
        output.entries = output.entries.map((entry) => ({
          ...entry,
          facts: output.entryFacts.find(({ entryId }) => entryId === entry.entryId)!.facts,
        }));
        return { ok: true as const, value: output };
      },
    };
    const inspected = await openDocument({ bytes, model, system, reader: owner });
    expect(inspected.inspect().verification.integrity, name).toBe("valid");
    expect(inspected.inspect().findings, name).toMatchObject([{ code: "SYSTEM_FAILED" }]);
    expect(inspected.inspect().entries, name).toBeNull();
    expect(inspected.inspect().audiences, name).toBeNull();
    expect(inspected.state(), name).toEqual({ status: "inspection", reason: "invalid" });
    expect(model.initial, name).not.toHaveBeenCalled();
    expect(model.reduce, name).not.toHaveBeenCalled();
    expect(model.reduceLocked, name).not.toHaveBeenCalled();
  }
});

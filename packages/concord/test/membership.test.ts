import { expect, test, vi } from "vite-plus/test";
import { encryptAge, identityFromSeed, type IdentityCapability } from "@ternent/armour";
import {
  createDocument,
  openDocument,
  type CommitSubject,
  type EntrySubject,
  type Snapshot,
} from "../src/index.js";
import { compareSnapshots, verifyDocument } from "../src/protocol/index.js";
import {
  createStandardSystemProfile,
  removeMember,
  setMember,
  type Capability,
} from "../src/system/index.js";
import { registerModel } from "../src/testing/index.js";
import { base64, decoded, encoded, hash, referenceSignature, seed } from "./fixtures.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}

const model = registerModel;
const otherSeed = (id: number) => new Uint8Array(32).fill(id);
const identity = async (id: number) => value(await identityFromSeed(otherSeed(id)));
const original = async () => value(await identityFromSeed(seed));
const decodeWire = (bytes: Uint8Array): Snapshot =>
  JSON.parse(new TextDecoder().decode(bytes)) as Snapshot;
const open = (bytes: Uint8Array, signer?: IdentityCapability) =>
  openDocument({ bytes, signer, model, system: createStandardSystemProfile() });
const create = async (owner: IdentityCapability) =>
  value(await createDocument({ identity: owner, model, system: createStandardSystemProfile() }));
const failure = (code: string) => ({ ok: false, error: { code } });

function lastSystem(bytes: Uint8Array) {
  const entry = decodeWire(bytes).entries.at(-1)!.subject;
  if (entry.kind !== "system") throw new Error("expected system entry");
  return entry;
}

function append(
  bytes: Uint8Array,
  subjects: EntrySubject[],
  signer: IdentityCapability,
  seed: Uint8Array,
): Uint8Array {
  const wire = decodeWire(bytes);
  const entries = subjects.map((subject) => ({ id: hash(subject, "entry"), subject }));
  const subject: CommitSubject = {
    version: 1,
    suite: "concord-25519-age-v1",
    parent: wire.head,
    nonce: base64(new Uint8Array(16).fill(100)),
    signer: signer.publicIdentity,
    declaration: null,
    entryIds: entries.map(({ id }) => id),
    metadata: null,
  };
  wire.head = hash(subject, "commit");
  wire.commits.push({ id: wire.head, subject, signature: referenceSignature(subject, seed) });
  wire.entries.push(...entries);
  return encoded(wire);
}

test("S01/S02 private admission gives complete history and separates viewing from authoring", async () => {
  const [owner, viewer, editor, outsider] = await Promise.all([
    original(),
    identity(2),
    identity(3),
    identity(4),
  ]);
  const document = await create(owner);
  value(await document.dispatch("set", { value: "before admission" }));
  const capabilities: Capability[] = ["write", "read"];
  const editorAdmission = setMember(document, { identity: editor.publicIdentity, capabilities });
  capabilities.pop();
  const viewerAdmission = setMember(document, {
    identity: viewer.publicIdentity,
    capabilities: ["read"],
  });
  const [editorReceipt, viewerReceipt] = (
    await Promise.all([editorAdmission, viewerAdmission])
  ).map(value);
  const saved = document.export();
  const wire = decodeWire(saved);
  expect(wire.commits.at(-1)!.subject.parent).toBe(editorReceipt.head);
  expect(wire.head).toBe(viewerReceipt.head);
  const editorEntry = wire.entries.at(-2)!.subject;
  expect(editorEntry.payload).toMatchObject({
    type: "system.member.set",
    data: { capabilities: ["read", "write"], history: [{ epoch: 0 }] },
  });
  const viewerDocument = await open(saved, viewer);
  expect(viewerDocument.state()).toMatchObject({
    status: "ready",
    canWrite: false,
    projection: { value: "before admission" },
  });
  expect(viewerDocument.inspect().otherRecipientsDecryptability).toBe("unverified");
  expect(await viewerDocument.dispatch("set", { value: "denied" })).toMatchObject(
    failure("CAPABILITY_DENIED"),
  );
  const editorDocument = await open(saved, editor);
  expect(
    await setMember(editorDocument, { identity: outsider.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  value(await editorDocument.dispatch("set", { value: "editor authorized" }));
  expect((await open(editorDocument.export(), viewer)).state()).toMatchObject({
    projection: { value: "editor authorized" },
  });
  const locked = await open(saved, outsider);
  expect(locked.state()).toEqual({ status: "inspection", reason: "locked" });
  expect(await removeMember(locked, { identityId: editor.publicIdentity.id })).toMatchObject(
    failure("INSPECTION_ONLY"),
  );
  const readOnly = await openDocument({
    bytes: saved,
    model,
    system: createStandardSystemProfile(),
    reader: { publicIdentity: viewer.publicIdentity, decryptAge: viewer.decryptAge },
  });
  expect(
    await setMember(readOnly, { identity: outsider.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("READ_ONLY_RUNTIME"));
});

test("S02/S03 grants are bounded even in independently signed history", async () => {
  const [owner, delegate, grantOnly, target, administrator] = await Promise.all([
    original(),
    identity(2),
    identity(3),
    identity(4),
    identity(5),
  ]);
  const document = await create(owner);
  for (const [member, capabilities] of [
    [delegate, ["read", "write", "grant"]],
    [grantOnly, ["read", "grant"]],
    [administrator, ["read", "administer"]],
  ] as const) {
    value(await setMember(document, { identity: member.publicIdentity, capabilities }));
  }
  const initial = document.export();
  const delegated = await open(initial, delegate);
  const input = { identity: target.publicIdentity, capabilities: ["read", "write"] } as const;
  value(await setMember(delegated, input));
  expect((await open(delegated.export(), target)).state()).toMatchObject({ canWrite: true });
  expect(
    await setMember(delegated, { identity: administrator.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  const grantOnlyDocument = await open(initial, grantOnly);
  expect(await setMember(grantOnlyDocument, input)).toMatchObject(failure("CAPABILITY_DENIED"));
  expect(
    await setMember(grantOnlyDocument, { ...input, capabilities: ["read", "administer"] }),
  ).toMatchObject(failure("CAPABILITY_DENIED"));
  value(await setMember(grantOnlyDocument, { ...input, capabilities: ["read"] }));
  const adminDocument = await open(initial, administrator);
  expect(adminDocument.state()).toMatchObject({ canWrite: false });
  value(await setMember(adminDocument, input));

  const forged = lastSystem(delegated.export());
  forged.payload.data.capabilities = ["read", "administer"];
  const unsignedAuthority = append(initial, [forged], delegate, otherSeed(2));
  expect((await verifyDocument(unsignedAuthority)).integrity).toBe("valid");
  const decryptAge = vi.fn(owner.decryptAge);
  const inspected = await openDocument({
    bytes: unsignedAuthority,
    model,
    system: createStandardSystemProfile(),
    reader: { publicIdentity: owner.publicIdentity, decryptAge },
  });
  expect(inspected.inspect().findings).toMatchObject([{ code: "CAPABILITY_DENIED" }]);
  expect(decryptAge).not.toHaveBeenCalled();
});

test("S04/S11 no-op grants and administrator protection are atomic", async () => {
  const [owner, another] = await Promise.all([original(), identity(2)]);
  const document = await create(owner);
  const before = document.export();
  expect(
    await setMember(document, {
      identity: owner.publicIdentity,
      capabilities: ["read", "write", "grant", "administer"],
    }),
  ).toMatchObject(failure("SYSTEM_NO_CHANGE"));
  expect(
    await setMember(document, { identity: owner.publicIdentity, capabilities: ["read"] }),
  ).toMatchObject(failure("LAST_ADMINISTRATOR"));
  expect(await removeMember(document, { identityId: another.publicIdentity.id })).toMatchObject(
    failure("SYSTEM_EVENT_INVALID"),
  );
  expect(await removeMember(document, { identityId: owner.publicIdentity.id })).toMatchObject(
    failure("LAST_ADMINISTRATOR"),
  );
  expect(document.export()).toEqual(before);

  value(
    await setMember(document, {
      identity: another.publicIdentity,
      capabilities: ["read", "administer"],
    }),
  );
  const admitted = document.export();
  expect(await removeMember(document, { identityId: owner.publicIdentity.id })).toMatchObject(
    failure("SYSTEM_EVENT_INVALID"),
  );
  expect(document.export()).toEqual(admitted);
  const admin = await open(admitted, another);
  value(await removeMember(admin, { identityId: owner.publicIdentity.id }));
  expect(admin.state()).toMatchObject({ status: "ready", canWrite: false });
});

test("S05-S08 and S12 revocation rotates keys and preserves both historical authorization and forks", async () => {
  const [owner, editor, other, newcomer] = await Promise.all([
    original(),
    identity(2),
    identity(3),
    identity(4),
  ]);
  const document = await create(owner);
  const editorInput = { identity: editor.publicIdentity, capabilities: ["read", "write"] } as const;
  value(await document.dispatch("set", { value: "first epoch" }));
  value(await setMember(document, editorInput));
  value(await setMember(document, { identity: other.publicIdentity, capabilities: ["read"] }));
  const editorDocument = await open(document.export(), editor);
  value(await editorDocument.dispatch("set", { value: "editor before removal" }));
  const before = editorDocument.export();
  const ownerDocument = await open(before, owner);

  value(await removeMember(ownerDocument, { identityId: editor.publicIdentity.id }));
  const afterRemoval = ownerDocument.export();
  const removal = lastSystem(afterRemoval);
  expect(removal.payload.data).toMatchObject({
    epoch: 1,
    wraps: [owner.publicIdentity.id, other.publicIdentity.id]
      .sort()
      .map((identityId) => ({ identityId })),
  });
  expect(ownerDocument.state()).toMatchObject({ projection: { value: "editor before removal" } });
  expect((await open(before, editor)).state()).toMatchObject({ status: "ready", canWrite: true });
  expect((await open(afterRemoval, editor)).state()).toEqual({
    status: "inspection",
    reason: "locked",
  });

  value(await editorDocument.dispatch("set", { value: "offline branch" }));
  const branch = editorDocument.export();
  expect(value(await compareSnapshots(branch, afterRemoval))).toBe("diverged");
  expect((await open(branch, editor)).state()).toMatchObject({
    projection: { value: "offline branch" },
  });
  const unauthorized = decodeWire(branch).entries.at(-1)!.subject;
  if (unauthorized.kind !== "application") throw new Error();
  unauthorized.parent = decodeWire(afterRemoval).head;
  unauthorized.payload.epoch = 1;
  const forged = append(afterRemoval, [unauthorized], editor, otherSeed(2));
  expect((await verifyDocument(forged)).integrity).toBe("valid");
  expect((await open(forged, owner)).inspect().findings).toMatchObject([
    { code: "CAPABILITY_DENIED" },
  ]);

  value(await ownerDocument.dispatch("set", { value: "after first rotation" }));
  value(await removeMember(ownerDocument, { identityId: other.publicIdentity.id }));
  value(await ownerDocument.dispatch("set", { value: "after second rotation" }));
  value(
    await setMember(ownerDocument, { identity: newcomer.publicIdentity, capabilities: ["read"] }),
  );
  expect(lastSystem(ownerDocument.export()).payload.data.history).toMatchObject([
    { epoch: 0 },
    { epoch: 1 },
    { epoch: 2 },
  ]);
  const newcomerDocument = await open(ownerDocument.export(), newcomer);
  expect(value(await newcomerDocument.replay())).toEqual({ value: "after second rotation" });

  value(await setMember(ownerDocument, editorInput));
  expect(lastSystem(ownerDocument.export()).payload.data.history).toMatchObject([
    { epoch: 0 },
    { epoch: 1 },
    { epoch: 2 },
  ]);
  const reAdmitted = await open(ownerDocument.export(), editor);
  expect(reAdmitted.state()).toMatchObject({
    canWrite: true,
    projection: { value: "after second rotation" },
  });
  value(await setMember(ownerDocument, { ...editorInput, capabilities: ["read"] }));
  expect(lastSystem(ownerDocument.export()).payload.data.history).toEqual([]);
  expect((await open(ownerDocument.export(), editor)).state()).toMatchObject({
    canWrite: false,
    projection: { value: "after second rotation" },
  });
});

test("S09 signed wrap invariants fail before decryption and decryptability is reader-specific", async () => {
  const members = await Promise.all([original(), identity(2), identity(3), identity(4)]);
  const [owner, target] = members;
  const document = await create(owner);
  for (const member of members.slice(1)) {
    value(await setMember(document, { identity: member.publicIdentity, capabilities: ["read"] }));
  }
  const before = document.export();
  value(await removeMember(document, { identityId: target.publicIdentity.id }));
  const rotation = lastSystem(document.export());
  const cases: ((wraps: { identityId: string; ciphertext: string }[]) => void)[] = [
    (wraps) => {
      wraps.pop();
    },
    (wraps) => {
      wraps.reverse();
    },
    (wraps) => {
      wraps[1] = { ...wraps[0] };
    },
  ];
  for (const corrupt of cases) {
    const entry = structuredClone(rotation);
    corrupt(entry.payload.data.wraps as { identityId: string; ciphertext: string }[]);
    const forged = append(before, [entry], owner, seed);
    expect((await verifyDocument(forged)).integrity).toBe("valid");
    const decryptAge = vi.fn(owner.decryptAge);
    const inspected = await openDocument({
      bytes: forged,
      model,
      system: createStandardSystemProfile(),
      reader: { publicIdentity: owner.publicIdentity, decryptAge },
    });
    expect(inspected.inspect().findings).toMatchObject([{ code: "SYSTEM_EVENT_INVALID" }]);
    expect(decryptAge).not.toHaveBeenCalled();
  }
  const victim = members[2];
  const wraps = rotation.payload.data.wraps as { identityId: string; ciphertext: string }[];
  wraps.find(({ identityId }) => identityId === victim.publicIdentity.id)!.ciphertext = "AA";
  const corrupt = append(before, [rotation], owner, seed);
  expect((await open(corrupt, owner)).state()).toMatchObject({ status: "ready" });
  expect((await open(corrupt, victim)).inspect().findings).toMatchObject([
    { code: "KEY_WRAP_INVALID" },
  ]);

  value(await setMember(document, { identity: target.publicIdentity, capabilities: ["read"] }));
  // Compare a reader that cannot open its old admission with one that can open every addressed wrap.
  const oldWrap = decodeWire(before).entries[1].subject;
  if (oldWrap.kind !== "system") throw new Error();
  const oldCiphertext = (oldWrap.payload.data.history as { ciphertext: string }[])[0].ciphertext;
  const replayed = await openDocument({
    bytes: document.export(),
    model,
    system: createStandardSystemProfile(),
    reader: {
      publicIdentity: target.publicIdentity,
      decryptAge: (bytes) =>
        base64(bytes) === oldCiphertext
          ? Promise.resolve({
              ok: false,
              error: { code: "DECRYPTION_FAILED", message: "test old wrap" },
            })
          : target.decryptAge(bytes),
    },
  });
  expect(replayed.inspect().findings).toMatchObject([{ code: "KEY_WRAP_INVALID" }]);
});

test("S10 removal and application in the same commit use the rotated epoch", async () => {
  const [owner, target] = await Promise.all([original(), identity(2)]);
  const document = await create(owner);
  value(
    await setMember(document, { identity: target.publicIdentity, capabilities: ["read", "write"] }),
  );
  const before = document.export();
  value(await removeMember(document, { identityId: target.publicIdentity.id }));
  const rotation = lastSystem(document.export());
  const wraps = rotation.payload.data.wraps as { ciphertext: string }[];
  const key = JSON.parse(
    new TextDecoder().decode(value(await owner.decryptAge(decoded(wraps[0].ciphertext)))),
  ) as { recipient: string };
  const context = { parent: rotation.parent, nonce: base64(new Uint8Array(16).fill(70)) };
  const ciphertext = value(
    await encryptAge({
      recipients: [key.recipient],
      plaintext: encoded({
        context: "concord.application/1",
        ...context,
        model: model.ref,
        audience: "document",
        epoch: 1,
        event: { type: "value.set", version: 1, data: { value: "same commit" } },
      }),
    }),
  );
  const application: EntrySubject = {
    version: 1,
    kind: "application",
    ...context,
    payload: { audience: "document", epoch: 1, ciphertext: base64(ciphertext) },
  };
  const valid = append(before, [rotation, application], owner, seed);
  expect((await open(valid, owner)).state()).toMatchObject({
    projection: { value: "same commit" },
  });
  application.payload.epoch = 0;
  const invalid = append(before, [rotation, application], owner, seed);
  expect((await open(invalid, owner)).inspect().findings).toMatchObject([
    { code: "SYSTEM_EVENT_INVALID" },
  ]);
});

test("membership failures preserve the committed head and captured inputs", async () => {
  const [owner, other] = await Promise.all([original(), identity(2)]);
  const document = await create(owner);
  const saved = document.export();
  const temporarilyBroken = await open(saved, {
    ...owner,
    sign: vi.fn().mockRejectedValue(new Error("host secret")),
  });
  const command = { identity: other.publicIdentity, capabilities: ["read"] } as const;
  expect(await setMember(temporarilyBroken, command)).toMatchObject(failure("SIGNING_FAILED"));
  expect(temporarilyBroken.export()).toEqual(saved);

  const input = { capabilities: ["read"] } as unknown as typeof command;
  const unexpectedGetter = vi.fn(() => other.publicIdentity);
  Object.defineProperty(input, "identity", { enumerable: true, get: unexpectedGetter });
  expect(await setMember(document, input)).toMatchObject(failure("SYSTEM_EVENT_INVALID"));
  expect(unexpectedGetter).not.toHaveBeenCalled();
  expect(document.export()).toEqual(saved);
  value(await setMember(document, command));
  expect((await open(document.export(), other)).state()).toMatchObject({ status: "ready" });
});

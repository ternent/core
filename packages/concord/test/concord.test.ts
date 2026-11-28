import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { base64urlnopad } from "@scure/base";
import { decrypt, encrypt } from "@ternent/armour";
import { createIdentity, restoreIdentity, type Identity } from "@ternent/identity";
import { createWriter, openLedger } from "@ternent/ledger";
import { generateX25519Identity, identityToRecipient } from "age-encryption";
import * as api from "../src/index.js";
import {
  createDocument,
  defineModel,
  openDocument,
  type Event,
  type GroupId,
  type Json,
} from "../src/index.js";

type Notes = { notes: { [id: string]: string } };

const notes = defineModel<Notes>({
  id: "notes",
  version: 1,
  initial: () => ({ notes: {} }),
  reduce(state, event) {
    const data = event.data as { id: string; title?: string };
    if (event.type === "note.put") return { notes: { ...state.notes, [data.id]: data.title! } };
    if (event.type === "note.remove") {
      if (!(data.id in state.notes)) throw new Error(`No note ${data.id}`);
      const { [data.id]: _removed, ...rest } = state.notes;
      return { notes: rest };
    }
    throw new Error(`Unknown event ${event.type}`);
  },
  squash(events) {
    const last = new Map(events.map((event) => [(event.data as { id: string }).id, event]));
    return [...last.values()];
  },
});

const put = (id: string, title: string): Event => ({ type: "note.put", data: { id, title } });
const encoder = new TextEncoder();

async function people() {
  const [alice, bob, carol, mallory] = await Promise.all(
    Array.from({ length: 4 }, () => createIdentity()),
  );
  return { alice, bob, carol, mallory };
}

// Builds a commit the public API would refuse, to test that replay rejects it.
async function forge(bytes: Uint8Array, signer: Identity, payloads: Uint8Array[]) {
  const writer = createWriter(await openLedger(bytes), signer);
  writer.append(
    payloads.map((payload) => ({ kind: "concord", payload: base64urlnopad.encode(payload) })),
  );
  return (await writer.commit()).export();
}

async function sealRecord(body: Record<string, Json>, secret: string) {
  const json = JSON.stringify({ concord: 1, ...body });
  return encrypt(encoder.encode(json), [await identityToRecipient(secret)]);
}

// The epoch secrets wrapped to `identity`, read directly from the bytes.
async function keysOf(bytes: Uint8Array, identity: Identity) {
  const keys = new Map<string, Record<string, string>>();
  for (const commit of (await openLedger(bytes)).commits) {
    for (const entry of commit.entries) {
      try {
        const opened = await decrypt(base64urlnopad.decode(entry.payload as string), identity);
        const wrap = JSON.parse(new TextDecoder().decode(opened));
        keys.set(wrap.group, { ...keys.get(wrap.group), ...wrap.epochs });
      } catch {
        // Not a wrap for this identity.
      }
    }
  }
  return keys;
}

test("the public interface is createDocument, defineModel and openDocument", () => {
  expect(Object.keys(api).sort()).toEqual(["createDocument", "defineModel", "openDocument"]);
  expect(defineModel(notes)).toBe(notes);
});

test("the saved vector opens with the expected state for each identity", async () => {
  const vector = JSON.parse(readFileSync(new URL("vector.json", import.meta.url), "utf8"));
  const bytes = encoder.encode(vector.document);
  for (const [name, backup] of Object.entries(vector.identities as Record<string, string>)) {
    const doc = await openDocument(bytes, {
      model: notes,
      identity: await restoreIdentity(backup),
    });
    const groups = Object.fromEntries(
      doc.groups.map((g) => [g.default ? "default" : "team", doc.state(g.id)]),
    );
    expect({ groups, unreadable: doc.unreadable, rejected: doc.rejected.length }).toEqual(
      vector.expected[name],
    );
    expect(doc.export()).toEqual(bytes);
  }
});

test("stage, commit, export and reopen give the same state", async () => {
  const { alice } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  expect(doc.state()).toEqual({ notes: {} });
  doc.stage(put("1", "Hello"));
  expect(doc.draft?.state).toEqual({ notes: { 1: "Hello" } });
  expect(doc.state()).toEqual({ notes: {} });
  await doc.commit();
  expect(doc.draft).toBeNull();
  const reopened = await openDocument(doc.export(), { model: notes, identity: alice });
  expect(reopened.state()).toEqual({ notes: { 1: "Hello" } });
  expect(reopened.head).toBe(doc.head);
  expect(reopened.rejected).toEqual([]);
  expect(reopened.unreadable).toBe(0);
  const ledger = await openLedger(doc.export());
  expect(ledger.commits.flatMap((commit) => commit.entries.map((entry) => entry.kind))).toEqual(
    Array(3).fill("concord"),
  );
});

test("a new member reads the group's whole history, and nothing outside it", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  doc.stage(put("1", "first"), { group: team });
  await doc.commit();
  doc.stage(put("2", "second"), { group: team });
  await doc.commit();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });

  const bobs = await openDocument(doc.export(), { model: notes, identity: bob });
  expect(bobs.state(team)).toEqual({ notes: { 1: "first", 2: "second" } });
  expect(bobs.groups.map((group) => group.id)).toEqual([team]);
  expect(bobs.groups[0].members.map((member) => member.role).sort()).toEqual(["admin", "member"]);
  expect(() => bobs.state()).toThrow(/cannot read/);
  expect(bobs.unreadable).toBeGreaterThan(0);
});

test("removal rotates the key: the removed member reads nothing new and cannot write", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  doc.stage(put("1", "before"), { group: team });
  await doc.commit();
  await doc.removeMember(bob.publicIdentity, { group: team });
  doc.stage(put("2", "after"), { group: team });
  await doc.commit();

  const bobs = await openDocument(doc.export(), { model: notes, identity: bob });
  expect(bobs.state(team)).toEqual({ notes: { 1: "before" } });
  expect(doc.groups.find((group) => group.id === team)?.members).toHaveLength(1);

  // Bob still thinks he is a member and writes with the old epoch key.
  bobs.stage(put("3", "from bob"), { group: team });
  await bobs.commit();
  const alices = await openDocument(bobs.export(), { model: notes, identity: alice });
  expect(alices.state(team)).toEqual({ notes: { 1: "before", 2: "after" } });
  expect(alices.rejected).toEqual([expect.objectContaining({ group: team, reason: "authority" })]);
});

test("replay rejects writes by non-members, obsolete epochs and non-admins", async () => {
  const { alice, bob, carol } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  await doc.setMember(carol.publicIdentity, { group: team, role: "member" });
  await doc.removeMember(carol.publicIdentity, { group: team });
  const bytes = doc.export();
  const bobKeys = (await keysOf(bytes, bob)).get(team)!;
  const carolKeys = (await keysOf(bytes, carol)).get(team)!;

  const cases: [Identity, Record<string, Json>, string][] = [
    [carol, { op: "events", events: [put("x", "carol")], version: 1 }, carolKeys["0"]],
    [bob, { op: "events", events: [put("x", "obsolete")], version: 1 }, bobKeys["0"]],
    [bob, { op: "set", identity: carol.publicIdentity, role: "member" }, bobKeys["1"]],
    [
      bob,
      { op: "remove", identity: alice.publicIdentity, epoch: 2 },
      await generateX25519Identity(),
    ],
  ];
  for (const [index, [signer, body, secret]] of cases.entries()) {
    const forged = await forge(bytes, signer, [await sealRecord(body, secret)]);
    const alices = await openDocument(forged, { model: notes, identity: alice });
    expect(alices.state(team)).toEqual({ notes: {} });
    expect(alices.groups.find((group) => group.id === team)?.members).toHaveLength(2);
    // The last forgery uses a key nobody was given, so it is unreadable, not rejected.
    if (index < 3) {
      expect(alices.rejected).toEqual([
        expect.objectContaining({ group: team, reason: "authority" }),
      ]);
    } else {
      expect(alices.rejected).toEqual([]);
    }
  }
});

test("replay rejects a role change on an obsolete epoch and removing the last admin", async () => {
  const { alice, bob, carol } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  await doc.setMember(carol.publicIdentity, { group: team, role: "member" });
  await doc.removeMember(carol.publicIdentity, { group: team });
  const bytes = doc.export();
  const keys = (await keysOf(bytes, alice)).get(team)!;

  const obsolete = await forge(bytes, alice, [
    await sealRecord({ op: "set", identity: bob.publicIdentity, role: "admin" }, keys["0"]),
  ]);
  const afterObsolete = await openDocument(obsolete, { model: notes, identity: alice });
  expect(afterObsolete.rejected).toEqual([expect.objectContaining({ reason: "authority" })]);
  expect(
    afterObsolete.groups
      .find((g) => g.id === team)
      ?.members.map((m) => m.role)
      .sort(),
  ).toEqual(["admin", "member"]);

  const next = await generateX25519Identity();
  const lastAdmin = await forge(bytes, alice, [
    await sealRecord({ op: "remove", identity: alice.publicIdentity, epoch: 2 }, next),
    await encrypt(
      encoder.encode(JSON.stringify({ concord: 1, group: team, epochs: { 2: next } })),
      [alice.publicIdentity],
    ),
  ]);
  const afterLastAdmin = await openDocument(lastAdmin, { model: notes, identity: alice });
  expect(afterLastAdmin.rejected).toEqual([
    expect.objectContaining({ reason: "authority", message: "A group keeps at least one admin" }),
  ]);
  expect(afterLastAdmin.groups.find((g) => g.id === team)?.members).toHaveLength(2);
});

test("a commit whose events fail reduce is rejected whole, and later commits still apply", async () => {
  const { alice } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const group = doc.groups[0].id;
  const secret = (await keysOf(doc.export(), alice)).get(group)!["0"];
  const bad = await sealRecord(
    {
      op: "events",
      events: [put("1", "kept?"), { type: "note.remove", data: { id: "missing" } }],
      version: 1,
    },
    secret,
  );
  const withBad = await forge(doc.export(), alice, [bad]);
  const later = await openDocument(withBad, { model: notes, identity: alice });
  later.stage(put("2", "later"));
  await later.commit();
  const reopened = await openDocument(later.export(), { model: notes, identity: alice });
  expect(reopened.state()).toEqual({ notes: { 2: "later" } });
  expect(reopened.rejected).toEqual([
    expect.objectContaining({ reason: "application", message: "No note missing" }),
  ]);
});

test("a group keeps at least one admin, and admins can promote and demote", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const group = doc.groups[0].id;
  await expect(doc.removeMember(alice.publicIdentity, { group })).rejects.toThrow(
    /at least one admin/,
  );
  await expect(doc.setMember(alice.publicIdentity, { group, role: "member" })).rejects.toThrow(
    /at least one admin/,
  );
  await doc.setMember(bob.publicIdentity, { group, role: "admin" });
  await doc.setMember(alice.publicIdentity, { group, role: "member" });
  const bobs = await openDocument(doc.export(), { model: notes, identity: bob });
  expect(bobs.groups[0].members.find((m) => m.identity.id === alice.publicIdentity.id)?.role).toBe(
    "member",
  );
  await expect(doc.setMember(bob.publicIdentity, { group, role: "member" })).rejects.toThrow(
    /admin/,
  );
});

test("two members agree on a group's state whatever other groups they belong to", async () => {
  const { alice, bob, carol } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  const leads = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  await doc.setMember(carol.publicIdentity, { group: team, role: "member" });
  await doc.setMember(bob.publicIdentity, { group: leads, role: "member" });
  doc.stage(put("1", "team"), { group: team });
  await doc.commit();
  doc.stage(put("2", "leads"), { group: leads });
  await doc.commit();
  const [bobs, carols] = await Promise.all(
    [bob, carol].map((identity) => openDocument(doc.export(), { model: notes, identity })),
  );
  expect(bobs.state(team)).toEqual(carols.state(team));
  expect(bobs.rejected).toEqual(carols.rejected);
  expect(() => carols.state(leads)).toThrow(/cannot read/);
});

test("a forged key wrap and an unsolicited group carry no authority", async () => {
  const { alice, bob, mallory } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  const bytes = doc.export();

  const fake = await generateX25519Identity();
  const wrap = await encrypt(
    encoder.encode(JSON.stringify({ concord: 1, group: team, epochs: { 1: fake } })),
    [bob.publicIdentity],
  );
  const removal = await sealRecord(
    { op: "remove", identity: alice.publicIdentity, epoch: 1 },
    fake,
  );
  const forged = await forge(bytes, mallory, [removal, wrap]);
  const bobs = await openDocument(forged, { model: notes, identity: bob });
  expect(bobs.groups.find((group) => group.id === team)?.members).toHaveLength(2);
  expect(bobs.rejected).toEqual([expect.objectContaining({ reason: "authority" })]);

  const theirs = await openDocument(bytes, { model: notes, identity: mallory });
  expect(theirs.groups).toEqual([]);
  const own = await theirs.createGroup();
  await theirs.setMember(alice.publicIdentity, { group: own, role: "member" });
  const alices = await openDocument(theirs.export(), { model: notes, identity: alice });
  expect(alices.groups.map((group) => group.id)).toContain(own);
  expect(alices.groups.find((group) => group.id === team)?.members).toHaveLength(2);
  expect(alices.groups.find((group) => group.default)?.members).toHaveLength(1);
});

test("each group pins its model, and a newer version refuses only that group", async () => {
  const { alice } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  const newer = defineModel({ ...notes, version: 2 });
  const v2 = await openDocument(doc.export(), { model: newer, identity: alice });
  v2.stage(put("1", "v2"), { group: team });
  await v2.commit();

  const v1 = await openDocument(v2.export(), { model: notes, identity: alice });
  expect(() => v1.state(team)).toThrow(/needs model version 2/);
  expect(v1.state()).toEqual({ notes: {} });
  const other = defineModel({ ...notes, id: "tasks" });
  const tasks = await openDocument(doc.export(), { model: other, identity: alice });
  expect(() => tasks.state()).toThrow(/uses model notes/);
});

test("reduce receives frozen state, so a mutating reducer cannot change accepted state", async () => {
  const { alice } = await people();
  const mutating = defineModel<Notes>({
    ...notes,
    reduce(state, event) {
      state.notes[(event.data as { id: string }).id] = "mutated";
      return state;
    },
  });
  const doc = await createDocument({ model: mutating, identity: alice });
  expect(() => doc.stage(put("1", "x"))).toThrow(TypeError);
  expect(doc.state()).toEqual({ notes: {} });
  expect(doc.draft).toBeNull();
});

test("squash shortens a draft, and a squash that changes the result fails the commit", async () => {
  const { alice } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  for (const title of ["H", "He", "Hello"]) doc.stage(put("1", title));
  await doc.commit();
  expect(doc.state()).toEqual({ notes: { 1: "Hello" } });

  const dropping = defineModel<Notes>({ ...notes, squash: (events) => events.slice(0, 1) });
  const broken = await openDocument(doc.export(), { model: dropping, identity: alice });
  broken.stage(put("2", "a"));
  broken.stage(put("3", "b"));
  await expect(broken.commit()).rejects.toThrow(/squash changed/);
  expect(broken.draft?.events).toHaveLength(2);
  expect(broken.state()).toEqual({ notes: { 1: "Hello" } });
});

test("a draft holds one group, and group operations wait for it", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  doc.stage(put("1", "default"));
  expect(() => doc.stage(put("2", "team"), { group: team })).toThrow(/one group/);
  await expect(doc.createGroup()).rejects.toThrow(/draft/);
  await expect(doc.setMember(bob.publicIdentity, { group: team, role: "member" })).rejects.toThrow(
    /draft/,
  );
  doc.discard();
  expect(doc.draft).toBeNull();
  await expect(doc.commit()).rejects.toThrow(/Nothing is staged/);
});

test("rebase reapplies only this identity's unpublished work and returns what no longer applies", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const group = doc.groups[0].id;
  await doc.setMember(bob.publicIdentity, { group, role: "member" });
  doc.stage(put("1", "shared"));
  await doc.commit();
  const published = doc.head;
  const shared = doc.export();

  const bobs = await openDocument(shared, { model: notes, identity: bob });
  bobs.stage(put("2", "bob"));
  await bobs.commit();
  bobs.stage({ type: "note.remove", data: { id: "1" } });
  await bobs.commit();

  doc.stage({ type: "note.remove", data: { id: "1" } });
  await doc.commit();
  const remote = doc.export();

  const returned = await bobs.rebase(remote, { published });
  expect(bobs.state()).toEqual({ notes: { 2: "bob" } });
  expect(returned).toEqual([
    expect.objectContaining({
      group,
      message: "No note 1",
      events: [{ type: "note.remove", data: { id: "1" } }],
    }),
  ]);
  const alices = await openDocument(bobs.export(), { model: notes, identity: alice });
  expect(alices.state()).toEqual({ notes: { 2: "bob" } });
  expect((await openLedger(bobs.export())).compare(await openLedger(remote))).toBe("ahead");

  // Rebasing again against the same remote reapplies nothing twice.
  expect(await bobs.rebase(remote, { published })).toEqual([]);
  expect(bobs.state()).toEqual({ notes: { 2: "bob" } });
});

test("rebase refuses other people's unpublished work, a draft and an unknown head", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const group = doc.groups[0].id;
  await doc.setMember(bob.publicIdentity, { group, role: "member" });
  const published = doc.head;
  const remote = doc.export();
  doc.stage(put("1", "alice"));
  await doc.commit();

  const bobs = await openDocument(doc.export(), { model: notes, identity: bob });
  await expect(bobs.rebase(remote, { published })).rejects.toThrow(/another identity/);
  bobs.stage(put("2", "bob"));
  await expect(bobs.rebase(remote, { published })).rejects.toThrow(/draft/);
  bobs.discard();
  await expect(bobs.rebase(remote, { published: `commit:${"0".repeat(64)}` })).rejects.toThrow(
    /not in this history/,
  );
  const membership = await openDocument(remote, { model: notes, identity: alice });
  await membership.setMember(bob.publicIdentity, { group, role: "admin" });
  const unrelated = await createDocument({ model: notes, identity: alice });
  await expect(membership.rebase(unrelated.export(), { published })).rejects.toThrow(
    /not in the remote/,
  );
  await expect(membership.rebase(remote, { published })).rejects.toThrow(/membership/);
});

test("tampered bytes do not open", async () => {
  const { alice } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const bytes = doc.export();
  const tampered = bytes.slice();
  tampered[tampered.length - 40] ^= 1;
  await expect(openDocument(tampered, { model: notes, identity: alice })).rejects.toThrow();
});

test("the raw bytes show no group ID, model, event type, role or data", async () => {
  const { alice, bob } = await people();
  const doc = await createDocument({ model: notes, identity: alice });
  const team = await doc.createGroup();
  await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
  doc.stage(put("note-id", "secret title"), { group: team });
  await doc.commit();
  const text = new TextDecoder().decode(doc.export());
  for (const hidden of [
    team,
    doc.groups[0].id as GroupId,
    '"notes"',
    "note.put",
    "admin",
    '"member"',
    "secret title",
  ]) {
    expect(text).not.toContain(hidden);
  }
});

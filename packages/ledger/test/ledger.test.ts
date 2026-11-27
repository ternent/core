import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { createHash } from "node:crypto";
import { createIdentity, type Identity } from "@ternent/identity";
import * as api from "../src/index.js";
import { createLedger, createWriter, openLedger, type History } from "../src/index.js";

const vector = JSON.parse(readFileSync(new URL("vectors.json", import.meta.url), "utf8"));
const utf8 = (text: string) => new TextEncoder().encode(text);
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
// An independent canonical form: keys sorted recursively, no whitespace. It writes the
// string directly because objects list integer-like keys ("2", "10") numerically.
const canonicalJson = (value: unknown): string =>
  Array.isArray(value)
    ? `[${value.map(canonicalJson).join(",")}]`
    : typeof value === "object" && value !== null
      ? `{${Object.keys(value)
          .sort()
          .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as never)[key])}`)
          .join(",")}}`
      : JSON.stringify(value);
const vectorBytes = () => utf8(canonicalJson(vector.document));
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

test("the public interface is create, open and write", () => {
  expect(Object.keys(api).sort()).toEqual(["createLedger", "createWriter", "openLedger"]);
});

test("the v2 vector opens with the expected IDs and exports the same bytes", async () => {
  const bytes = vectorBytes();
  const history = await openLedger(bytes);
  expect(history.documentId).toBe(vector.expected.documentId);
  expect(history.head).toBe(vector.expected.head);
  expect(
    history.commits.map((commit) => ({ id: commit.id, entryIds: commit.entries.map((e) => e.id) })),
  ).toEqual(
    vector.expected.commits.map((c: { commitId: string; entryIds: string[] }) => ({
      id: c.commitId,
      entryIds: c.entryIds,
    })),
  );
  expect(history.export()).toEqual(bytes);
  expect(bytes.length).toBe(1403);
});

test("IDs and signed messages match an independent Node hash of the vector", async () => {
  const history = await openLedger(vectorBytes());
  vector.expected.commits.forEach(
    (expected: { bodyMessageUtf8: string; signatureMessageUtf8: string }, index: number) => {
      const commit = history.commits[index];
      expect(commit.proof.subject.hash).toBe(`sha256:${sha256(expected.bodyMessageUtf8)}`);
      const proofJson = JSON.parse(expected.signatureMessageUtf8.split("\0")[1]);
      expect(proofJson.subject.hash).toBe(commit.proof.subject.hash);
    },
  );
  const child = history.commits[1];
  expect(text(history.export())).toContain('"payload":{"10":"train","2":"travel"}');
  expect(child.entries[0].meta).toEqual({ example: true });
});

test("create, write, commit, export and reopen round-trip", async () => {
  const alice = await createIdentity();
  const genesis = await createLedger({ signer: alice, metadata: { model: "expenses" } });
  expect(genesis.commits).toHaveLength(1);
  expect(genesis.commits[0].entries).toEqual([]);

  const writer = createWriter(genesis, alice);
  writer.append({ kind: "expense.recorded", payload: { amount: 2500, note: "café ☕" } });
  writer.append([
    { kind: "expense.tagged", payload: ["travel"], meta: { source: "test" } },
    { kind: "expense.noted", payload: null },
  ]);
  expect(writer.staged).toHaveLength(3);
  const next = await writer.commit({ device: "phone" });

  expect(writer.history).toBe(next);
  expect(writer.staged).toEqual([]);
  expect(genesis.commits).toHaveLength(1);
  expect(next.commits[0]).toBe(genesis.commits[0]);
  expect(next.commits[1].parent).toBe(genesis.head);
  expect(next.commits[1].proof.signer).toEqual(alice.publicIdentity);

  const bytes = next.export();
  const reopened = await openLedger(bytes);
  expect(reopened.commits).toEqual(next.commits);
  expect(reopened.export()).toEqual(bytes);
  expect(reopened.compare(next)).toBe("equal");
  await expect(openLedger(bytes, { maxBytes: bytes.length })).resolves.toBeDefined();
  await expect(openLedger(bytes, { maxBytes: bytes.length - 1 })).rejects.toThrow(RangeError);
});

test("staged entry IDs are kept through commit", async () => {
  const alice = await createIdentity();
  const writer = createWriter(await createLedger({ signer: alice }), alice);
  writer.append({ kind: "a", payload: 1, nonce: "AAAAAAAAAAAAAAAAAAAAAA" });
  const [staged] = writer.staged;
  const history = await writer.commit();
  expect(history.commits[1].entries[0]).toEqual(staged);
  const reopened = await openLedger(history.export());
  expect(reopened.commits[1].entries[0].id).toBe(staged.id);
});

test("compare reports equal, ahead, behind, diverged and unrelated", async () => {
  const alice = await createIdentity();
  const base = await createLedger({ signer: alice });
  const one = createWriter(base, alice);
  one.append({ kind: "a", payload: 1 });
  const ahead = await one.commit();
  const two = createWriter(base, alice);
  two.append({ kind: "b", payload: 2 });
  const fork = await two.commit();
  const other = await createLedger({ signer: alice });

  expect(base.compare(base)).toBe("equal");
  expect(ahead.compare(base)).toBe("ahead");
  expect(base.compare(ahead)).toBe("behind");
  expect(ahead.compare(fork)).toBe("diverged");
  expect(base.compare(other)).toBe("unrelated");
});

test("histories can only come from Ledger", async () => {
  const alice = await createIdentity();
  const history = await createLedger({ signer: alice });
  const lookalike = { ...history, commits: history.commits } as History;
  const prototypeCopy = Object.create(Object.getPrototypeOf(history)) as History;
  expect(() => createWriter(lookalike, alice)).toThrow();
  expect(() => createWriter(prototypeCopy, alice)).toThrow();
  expect(() => history.compare(lookalike)).toThrow();
  const Constructor = history.constructor as new (...args: unknown[]) => History;
  expect(() => new Constructor(Symbol("issue"), [], [], 0, 1)).toThrow();
});

test("an empty commit rejects, and discard clears staging", async () => {
  const alice = await createIdentity();
  const writer = createWriter(await createLedger({ signer: alice }), alice);
  await expect(writer.commit()).rejects.toThrow();
  writer.append({ kind: "a", payload: 1 });
  writer.discard();
  expect(writer.staged).toEqual([]);
  writer.append([]);
  expect(writer.staged).toEqual([]);
});

test("a batch is validated whole before any of it is staged", async () => {
  const alice = await createIdentity();
  const writer = createWriter(await createLedger({ signer: alice }), alice);
  const nonce = "AAAAAAAAAAAAAAAAAAAAAA";
  writer.append({ kind: "a", payload: 1, nonce });
  const invalid = [
    [
      { kind: "ok", payload: 1 },
      { kind: "", payload: 1 },
    ],
    [
      { kind: "ok", payload: 1 },
      { kind: "x".repeat(129), payload: 1 },
    ],
    [
      { kind: "ok", payload: 1 },
      { kind: "b", payload: 1, nonce },
    ],
    [{ kind: "b", payload: 1, nonce: "short" }],
    [{ kind: "b", payload: 1.5 }],
    [{ kind: "b", payload: -0 }],
    [{ kind: "b", payload: Number.MAX_SAFE_INTEGER + 1 }],
    [{ kind: "b", payload: "\ud800" }],
    [{ kind: "b", payload: new Date() }],
    [{ kind: "b", payload: undefined }],
    [{ kind: "b", payload: 1, meta: [] }],
  ];
  for (const batch of invalid) expect(() => writer.append(batch as never)).toThrow();
  expect(writer.staged).toHaveLength(1);
});

test("inputs are copied when staged and committed views are frozen", async () => {
  const alice = await createIdentity();
  const writer = createWriter(await createLedger({ signer: alice }), alice);
  const payload = { amount: 1, tags: ["a"] };
  writer.append({ kind: "a", payload });
  payload.tags.push("b");
  const history = await writer.commit();
  const entry = history.commits[1].entries[0];
  expect(entry.payload).toEqual({ amount: 1, tags: ["a"] });
  expect(Object.isFrozen(entry.payload)).toBe(true);
  expect(Object.isFrozen(history.commits)).toBe(true);
  expect(() => (history.commits as Commit[]).push(history.commits[0])).toThrow();
});
type Commit = History["commits"][number];

test("mutations reject during a commit; reads see the previous history", async () => {
  const alice = await createIdentity();
  const history = await createLedger({ signer: alice });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slowSigner = {
    publicIdentity: alice.publicIdentity,
    sign: async (bytes: Uint8Array) => {
      await gate;
      return alice.sign(bytes);
    },
  };
  const writer = createWriter(history, slowSigner);
  writer.append({ kind: "a", payload: 1 });
  const pending = writer.commit();
  expect(writer.history).toBe(history);
  expect(writer.staged).toHaveLength(1);
  expect(() => writer.append({ kind: "b", payload: 2 })).toThrow();
  expect(() => writer.discard()).toThrow();
  await expect(writer.commit()).rejects.toThrow();
  release();
  await pending;
  writer.append({ kind: "b", payload: 2 });
  expect(writer.staged).toHaveLength(1);
});

test("a failed commit keeps history and staging, and a retry succeeds", async () => {
  const alice = await createIdentity();
  const mallory = await createIdentity();
  const history = await createLedger({ signer: alice });
  let wrongKey = true;
  const flaky: Pick<Identity, "publicIdentity" | "sign"> = {
    publicIdentity: alice.publicIdentity,
    sign: (bytes) => (wrongKey ? mallory.sign(bytes) : alice.sign(bytes)),
  };
  const writer = createWriter(history, flaky);
  writer.append({ kind: "a", payload: 1 });
  await expect(writer.commit()).rejects.toThrow();
  expect(writer.history).toBe(history);
  expect(writer.staged).toHaveLength(1);
  wrongKey = false;
  expect((await writer.commit()).commits).toHaveLength(2);
});

test("a commit that would pass maxBytes rejects and keeps staging", async () => {
  const alice = await createIdentity();
  const genesis = await createLedger({ signer: alice, maxBytes: 2000 });
  const writer = createWriter(genesis, alice);
  writer.append({ kind: "a", payload: "x".repeat(2000) });
  await expect(writer.commit()).rejects.toThrow(RangeError);
  expect(writer.staged).toHaveLength(1);
  writer.discard();
  writer.append({ kind: "a", payload: "é".repeat(100) });
  const next = await writer.commit();
  expect(next.export().length).toBeLessThanOrEqual(2000);
  await expect(openLedger(next.export(), { maxBytes: 2000 })).resolves.toBeDefined();
});

test("open rejects tampering, broken linkage, non-canonical bytes and other versions", async () => {
  const doc = () => structuredClone(vector.document);
  const reject = async (document: unknown) =>
    expect(openLedger(utf8(canonicalJson(document)))).rejects.toThrow();

  const payload = doc();
  payload.commits[1].body.entries[0].payload.amount = 2501;
  await reject(payload);
  const kind = doc();
  kind.commits[1].body.entries[1].kind = "expense.untagged";
  await reject(kind);
  const parent = doc();
  parent.commits[1].body.parent = `commit:${"0".repeat(64)}`;
  await reject(parent);
  const order = doc();
  order.commits.reverse();
  await reject(order);
  const signer = doc();
  signer.commits[1].proof.signer = signer.commits[0].proof.signer;
  await reject(signer);
  const extra = doc();
  extra.commits[1].body.entries[0].extra = true;
  await reject(extra);
  const empty = doc();
  empty.commits[1].body.entries = [];
  await reject(empty);
  const duplicate = doc();
  duplicate.commits[1].body.entries[1].nonce = duplicate.commits[1].body.entries[0].nonce;
  await reject(duplicate);
  await reject({ ...doc(), version: 1 });
  await reject({ ...doc(), commits: [] });

  const canonical = text(vectorBytes());
  for (const variant of [
    JSON.stringify(vector.document, null, 2),
    `﻿${canonical}`,
    canonical.replace('"amount":2500', '"amount":2.5e3'),
    canonical.replace('"format":"ledger"', '"format":"ledger","format":"ledger"'),
    canonical.replace('"model"', '"\\u006dodel"'),
  ]) {
    await expect(openLedger(utf8(variant))).rejects.toThrow();
  }
  await expect(openLedger(new Uint8Array([0xff]))).rejects.toThrow();
});

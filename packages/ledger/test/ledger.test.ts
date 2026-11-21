import { createHash, createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { signerFromSeed, type BaseIdentityCapability } from "@ternent/identity";
import {
  createLedger,
  verifyLedger,
  compareLedgers,
  encodeJson,
  Fault,
  type LedgerSnapshot,
  type LedgerSigner,
} from "../src/index.js";

const seed = Uint8Array.from(
  Buffer.from("9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60", "hex"),
);
async function signer(byte?: number): Promise<BaseIdentityCapability> {
  const result = await signerFromSeed(byte === undefined ? seed : new Uint8Array(32).fill(byte));
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const now = () => "2026-11-21T00:00:00.000Z";
function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
    .join(",")}}`;
}
async function saved(): Promise<LedgerSnapshot> {
  const log = await createLedger({ signer: await signer(), now });
  await log.create({ metadata: { title: "log" } });
  await log.append({ kind: "reading", payload: { value: 7 } });
  await log.commit();
  return log.export();
}
test("standalone staged log: create, append, preview, commit, export and reopen", async () => {
  const log = await createLedger({ signer: await signer(), now });
  await log.create();
  const empty = await log.export();
  const input = { kind: "measurement", payload: { value: 0 } };
  const appended = log.append(input);
  input.payload.value = 99;
  await appended;
  expect(await log.export()).toEqual(empty);
  expect(await log.replay()).toMatchObject([
    { kind: "measurement", payload: { data: { value: 0 } }, committed: false },
  ]);
  expect(await log.replay({ includeStaged: false })).toEqual([]);
  expect((await log.verify()).integrity).toBe("valid");
  const meta = { note: "captured" };
  const pending = log.commit({ metadata: meta });
  meta.note = "changed";
  const receipt = await pending;
  expect(receipt.commit.subject.metadata).toEqual({ note: "captured" });
  expect(log.getState().staged).toEqual([]);
  const snapshot = await log.export();
  const reopened = await createLedger();
  await reopened.import(encodeJson(snapshot));
  expect(await reopened.replay()).toEqual(await log.replay());
  expect(await reopened.replay()).toMatchObject([{ committed: true, commitId: receipt.commit.id }]);
  await expect(reopened.append({ kind: "no" })).rejects.toMatchObject({
    finding: { code: "READ_ONLY_RUNTIME" },
  });
});
test("independent Node author verifies Ledger hash and signature subjects", async () => {
  const fixed = JSON.parse(
    readFileSync(new URL("./vectors/signed-log.json", import.meta.url), "utf8"),
  ) as LedgerSnapshot;
  const generated = await saved();
  const key = createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]),
    format: "der",
    type: "pkcs8",
  });
  for (const wire of [fixed, generated]) {
    for (const [kind, records] of [
      ["entry", wire.entries],
      ["commit", wire.commits],
    ] as const)
      for (const record of records)
        expect(record.id).toBe(
          `${kind}:${createHash("sha256").update(`ledger.${kind}/1\0`).update(canonical(record.subject)).digest("hex")}`,
        );
    for (const record of wire.commits)
      expect(record.signature).toBe(
        sign(null, Buffer.from(`ledger.signature/1\0${canonical(record.subject)}`), key).toString(
          "base64url",
        ),
      );
    expect((await verifyLedger(encodeJson(wire))).integrity).toBe("valid");
  }
  const reader = await createLedger();
  await reader.import(fixed);
  expect((await reader.replay())[0].payload.data).toEqual({ value: 7 });
});
test("custom projection replays saved history and includes explicitly marked staged entries", async () => {
  const log = await createLedger({
    signer: await signer(),
    now,
    initialProjection: 0,
    projector: (total, entry) => total + Number((entry.payload.data as { value: number }).value),
  });
  await log.load(await saved());
  expect(await log.replay()).toBe(7);
  await log.append({ kind: "reading", payload: { value: 3 } });
  expect(log.getState().projection).toBe(10);
  expect(await log.replay({ includeStaged: false })).toBe(7);
  await log.clearStaged();
  expect(await log.recompute()).toBe(7);
});
test("concurrent operations serialize into the same commit, with no lost entries", async () => {
  const log = await createLedger({ signer: await signer(), now });
  await log.create();
  const [a, b, committed] = await Promise.all([
    log.append({ kind: "a", payload: 1 }),
    log.append({ kind: "b", payload: 2 }),
    log.commit(),
  ]);
  expect(committed.committedEntryIds).toEqual([a.entry.id, b.entry.id]);
  expect((await log.export()).entries).toHaveLength(2);
});
test("genesis entries and supplied context nonces use the same Ledger lifecycle", async () => {
  const log = await createLedger({ signer: await signer(), now });
  const contextNonce = Buffer.alloc(16, 7).toString("base64url");
  await log.create({
    metadata: { framework: "example" },
    entries: [{ kind: "init", nonce: contextNonce, payload: { initialized: true } }],
  });
  const wire = await log.export();
  expect(wire.commits).toHaveLength(1);
  expect(wire.entries).toHaveLength(1);
  expect(wire.entries[0].subject).toMatchObject({ parent: null, nonce: contextNonce });
  expect((await log.verify()).integrity).toBe("valid");
  await log.append({ kind: "next", nonce: contextNonce });
  const before = log.getState();
  await expect(log.append({ kind: "duplicate", nonce: contextNonce })).rejects.toMatchObject({
    finding: { code: "SCHEMA_INVALID" },
  });
  expect(log.getState()).toBe(before);
  await expect(log.append({ kind: "malformed", nonce: "bad" })).rejects.toMatchObject({
    finding: { code: "SCHEMA_INVALID" },
  });
});
test("signing failures preserve the committed snapshot and staged entries for retry", async () => {
  const identity = await signer();
  let broken = false;
  const cap: LedgerSigner = {
    publicIdentity: identity.publicIdentity,
    sign: (bytes) => {
      if (broken) throw new Error("secret implementation failure");
      return identity.sign(bytes);
    },
  };
  const log = await createLedger({ signer: cap, now });
  await log.create();
  await log.append({ kind: "retry", payload: false });
  const before = log.getState();
  broken = true;
  await expect(log.commit()).rejects.toMatchObject({ finding: { code: "SIGNING_FAILED" } });
  expect(log.getState()).toBe(before);
  broken = false;
  await log.commit();
  expect(log.getState().staged).toEqual([]);
});
test("a signature from another key cannot publish a candidate", async () => {
  const a = await signer(),
    b = await signer(2);
  const log = await createLedger({
    signer: { publicIdentity: a.publicIdentity, sign: b.sign },
    now,
  });
  await expect(log.create()).rejects.toMatchObject({ finding: { code: "SIGNATURE_INVALID" } });
  expect(log.getState().container).toBeNull();
});
test("invalid inputs and failed batch projections leave staged and committed state intact", async () => {
  const log = await createLedger({
    signer: await signer(),
    now,
    initialProjection: [] as string[],
    projector: (entries, entry) => {
      if (entry.kind === "rejected") throw new Error("reducer failure");
      return [...entries, entry.kind];
    },
  });
  await log.create();
  const before = log.getState();
  await expect(log.appendMany([{ kind: "ok" }, { kind: "rejected" }])).rejects.toThrow(
    "reducer failure",
  );
  expect(log.getState()).toBe(before);
  let read = false;
  const payload = Object.defineProperty({}, "value", {
    enumerable: true,
    get() {
      read = true;
      return 1;
    },
  });
  await expect(log.append({ kind: "accessor", payload })).rejects.toBeInstanceOf(Fault);
  expect(read).toBe(false);
  expect(log.getState()).toBe(before);
  await log.append({ kind: "ok" });
  await expect(log.load(await saved())).rejects.toMatchObject({
    finding: { code: "DRAFT_PENDING" },
  });
  expect(log.getState().staged).toHaveLength(1);
});
test("tampering, duplicate records, unsupported formats and bad signatures never replace valid state", async () => {
  const original = await saved();
  const mutations: ((wire: LedgerSnapshot) => void)[] = [
    (wire) => {
      wire.entries[0].subject.payload.data = "tampered";
    },
    (wire) => {
      wire.commits[1].subject.metadata = { altered: true };
    },
    (wire) => {
      wire.commits[1].signature = Buffer.alloc(64).toString("base64url");
    },
    (wire) => {
      wire.entries.push(wire.entries[0]);
    },
    (wire) => {
      wire.commits.reverse();
    },
    (wire) => {
      wire.format = "concord" as "ledger";
    },
  ];
  const log = await createLedger();
  await log.load(original);
  for (const mutate of mutations) {
    const wire = structuredClone(original);
    mutate(wire);
    expect((await verifyLedger(encodeJson(wire))).integrity).not.toBe("valid");
    await expect(log.import(wire)).rejects.toBeInstanceOf(Fault);
    expect(await log.export()).toEqual(original);
  }
});
test("new signers can append without introducing framework membership or authority policy", async () => {
  const log = await createLedger({ signer: await signer(3), now });
  await log.load(await saved());
  await log.append({ kind: "second-writer" });
  await log.commit();
  expect((await log.verify()).integrity).toBe("valid");
  const wire = await log.export();
  expect(wire.entries[1].subject.author).toBe(wire.commits[2].subject.signer.id);
});
test("snapshot relationships retain independent forks and reject cross-protocol imports", async () => {
  const base = await saved(),
    a = await createLedger({ signer: await signer(), now }),
    b = await createLedger({ signer: await signer(2), now });
  await a.load(base);
  await b.load(base);
  await a.append({ kind: "a" });
  await b.append({ kind: "b" });
  await a.commit();
  await b.commit();
  const x = encodeJson(await a.export()),
    y = encodeJson(await b.export());
  expect(await compareLedgers(x, y)).toEqual({ ok: true, value: "diverged" });
  expect(await compareLedgers(encodeJson(base), x)).toEqual({ ok: true, value: "behind" });
});
test("resource bounds and observer failures preserve usable committed state", async () => {
  const log = await createLedger({
    signer: await signer(),
    now,
    limits: { maxPayloadBytes: 16, maxMetadataBytes: 16 },
  });
  let notifications = 0;
  const unsubscribe = log.subscribe(() => {
    notifications++;
    throw new Error("observer");
  });
  await log.create();
  await expect(log.append({ kind: "large", payload: "x".repeat(20) })).rejects.toMatchObject({
    finding: { code: "RESOURCE_LIMIT" },
  });
  await log.append({ kind: "ok", payload: null });
  await expect(log.commit({ metadata: { large: "x".repeat(20) } })).rejects.toMatchObject({
    finding: { code: "RESOURCE_LIMIT" },
  });
  await log.commit();
  expect(notifications).toBeGreaterThan(2);
  unsubscribe();
  await log.destroy();
  await expect(log.export()).rejects.toMatchObject({ finding: { code: "LEDGER_DESTROYED" } });
});
test("default Ledger readers accept opaque framework payloads within the shared snapshot cap", async () => {
  const log = await createLedger({ signer: await signer(), now });
  await log.create();
  await log.append({ kind: "opaque", payload: { ciphertext: "A".repeat(1400 * 1024) } });
  await log.commit();
  const reader = await createLedger();
  await reader.load(await log.export());
  expect((await reader.verify()).integrity).toBe("valid");
});
test("callbacks cannot synchronously reenter the same mutation queue", async () => {
  const log = await createLedger({ signer: await signer(), now });
  await log.create();
  const attempts: Promise<unknown>[] = [];
  log.subscribe(() => {
    attempts.push(log.append({ kind: "recursive" }));
  });
  await Promise.all(
    attempts.map((pending) =>
      expect(pending).rejects.toMatchObject({ finding: { code: "HOST_CONFIGURATION" } }),
    ),
  );
  expect(log.getState().staged).toEqual([]);
});
test("invalid option shapes cannot sign or change the current state", async () => {
  const identity = await signer();
  let signatures = 0;
  const log = await createLedger({
    signer: {
      publicIdentity: identity.publicIdentity,
      sign(bytes) {
        signatures++;
        return identity.sign(bytes);
      },
    },
    now,
  });
  const empty = log.getState();
  for (const invalid of [null, 7, false, "", []]) {
    await expect(createLedger(invalid as never)).rejects.toMatchObject({
      finding: { code: "HOST_CONFIGURATION" },
    });
    await expect(log.create(invalid as never)).rejects.toMatchObject({
      finding: { code: "SCHEMA_INVALID" },
    });
    expect(log.getState()).toBe(empty);
  }
  expect(signatures).toBe(0);
  await expect(createLedger({ limits: [] as never })).rejects.toMatchObject({
    finding: { code: "HOST_CONFIGURATION" },
  });
  await log.create();
  await log.append({ kind: "pending" });
  const staged = log.getState();
  for (const invalid of [null, 7, false, "", []]) {
    await expect(log.commit(invalid as never)).rejects.toMatchObject({
      finding: { code: "SCHEMA_INVALID" },
    });
    await expect(log.replay(invalid as never)).rejects.toMatchObject({
      finding: { code: "HOST_CONFIGURATION" },
    });
    expect(log.getState()).toBe(staged);
  }
  expect(signatures).toBe(1);
  await log.commit();
  expect(signatures).toBe(2);
});
test("oversized byte imports reject and preserve the current state", async () => {
  const log = await createLedger({ signer: await signer(), now, limits: { maxBytes: 4096 } });
  await log.create();
  const before = log.getState();
  const input = new Uint8Array(4097);
  for (const load of [
    (bytes: Uint8Array) => log.load(bytes),
    (bytes: Uint8Array) => log.import(bytes),
  ]) {
    await expect(load(input)).rejects.toMatchObject({ finding: { code: "RESOURCE_LIMIT" } });
    expect(log.getState()).toBe(before);
  }
});

import { expect, test } from "vite-plus/test";
import { verifyLedger } from "@ternent/ledger";
import {
  canonicalize,
  compareSnapshots,
  hashCommitSubject,
  hashEntrySubject,
  verifyDocument,
  type Snapshot,
} from "../src/protocol/index.js";
import {
  vector,
  encoded,
  reference,
  mutate,
  resign,
  base64,
  protectedPayload,
  type Mutation,
} from "./fixtures.js";
const owner = () => vector<Snapshot>("owner.document");
const primitives = vector<{
  canonical: { id: string; inputJson: string; canonical: string }[];
  rejectedJson: { id: string; inputJson: string; errorCode: string }[];
}>("primitives");
function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
for (const item of primitives.canonical)
  test(`P01 ${item.id}`, () =>
    expect(new TextDecoder().decode(value(canonicalize(JSON.parse(item.inputJson))))).toBe(
      item.canonical,
    ));
for (const item of primitives.rejectedJson)
  test(`P02 ${item.id}`, async () =>
    expect((await verifyDocument(new TextEncoder().encode(item.inputJson))).findings[0].code).toBe(
      item.errorCode,
    ));
test("P02 malformed UTF-8, BOM and trailing data", async () => {
  for (const bytes of [
    new Uint8Array([255]),
    new TextEncoder().encode("\ufeff{}"),
    new TextEncoder().encode("{} {}"),
  ])
    expect((await verifyDocument(bytes)).findings[0].code).toBe("JSON_INVALID");
});
test("P03 unsafe values reject without invoking accessors", () => {
  let invoked = false;
  const accessor = Object.defineProperty({}, "x", {
    enumerable: true,
    get() {
      invoked = true;
      return 1;
    },
  });
  const cycle: unknown[] = [];
  cycle.push(cycle);
  for (const input of [
    NaN,
    Infinity,
    -0,
    0.5,
    undefined,
    1n,
    () => 1,
    Array(2),
    accessor,
    new Date(),
    cycle,
    { [Symbol()]: 1 },
    Object.create({ x: 1 }),
    Object.setPrototypeOf([], null),
  ])
    expect(canonicalize(input)).toMatchObject({ ok: false });
  expect(invoked).toBe(false);
});
test("P08 exact entry/commit IDs, canonical signature subjects and signatures", async () => {
  const document = owner(),
    expected = vector<{
      commits: {
        id: string;
        canonicalSubject: string;
        signatureMessageHex: string;
        signatureHex: string;
      }[];
      entries: { id: string; canonicalSubject: string }[];
    }>("owner.expected");
  document.entries.forEach((entry, i) => {
    expect(value(hashEntrySubject(entry.subject))).toBe(expected.entries[i].id);
    expect(new TextDecoder().decode(value(canonicalize(entry.subject)))).toBe(
      expected.entries[i].canonicalSubject,
    );
  });
  document.commits.forEach((commit, i) => {
    expect(value(hashCommitSubject(commit.subject))).toBe(expected.commits[i].id);
    expect(reference(commit.subject)).toBe(expected.commits[i].canonicalSubject);
    expect(Buffer.from(`ledger.signature/1\0${reference(commit.subject)}`).toString("hex")).toBe(
      expected.commits[i].signatureMessageHex,
    );
    expect(Buffer.from(commit.signature, "base64url").toString("hex")).toBe(
      expected.commits[i].signatureHex,
    );
  });
  expect(await verifyDocument(encoded(document))).toEqual({
    integrity: "valid",
    documentId: document.documentId,
    head: document.head,
    checkedCommits: 2,
    checkedEntries: 2,
    findings: [],
  });
});
for (const item of vector<{ cases: Mutation[] }>("mutations").cases)
  test(`P mutation ${item.id}`, async () => {
    const result = await verifyDocument(encoded(mutate(owner(), item.operations)));
    expect(result.integrity).toBe(item.expected.integrity);
    expect(result.findings[0].code).toBe(item.expected.code);
  });
test("P04 encodings and closed schemas fail without normalization", async () => {
  const cases: [(wire: Snapshot) => void, string][] = [
    [
      (wire) => {
        wire.commits[1].signature += "=";
      },
      "SCHEMA_INVALID",
    ],
    [
      (wire) => {
        wire.commits[1].signature = wire.commits[1].signature.slice(0, -1) + "B";
      },
      "SCHEMA_INVALID",
    ],
    [
      (wire) => {
        wire.commits[1].subject.signer = { ...wire.commits[1].subject.signer, publicKey: "AA" };
      },
      "IDENTITY_INVALID",
    ],
    [
      (wire) => {
        Object.assign(wire.entries[0].subject, { extra: true });
      },
      "SCHEMA_INVALID",
    ],
    [
      (wire) => {
        wire.entries[0].id = wire.entries[0].id.toUpperCase() as Snapshot["entries"][number]["id"];
      },
      "SCHEMA_INVALID",
    ],
  ];
  for (const [modify, code] of cases) {
    const wire = owner();
    modify(wire);
    expect((await verifyDocument(encoded(wire))).findings[0].code).toBe(code);
  }
});
test("P06 identity binding is checked after independent rehashing/signing", async () => {
  const wire = owner();
  Object.assign(wire.commits[1].subject.signer, { id: `identity:${"0".repeat(64)}` });
  resign(wire);
  expect((await verifyDocument(encoded(wire))).findings[0].code).toBe("IDENTITY_INVALID");
});
test("P13 ordered entry IDs bind hashes and signatures", async () => {
  const wire = owner(),
    extra = structuredClone(wire.entries[1]);
  extra.subject.nonce = base64(new Uint8Array(16).fill(9));
  wire.entries.push(extra);
  wire.commits[1].subject.entryIds.push(extra.id);
  resign(wire);
  expect((await verifyDocument(encoded(wire))).integrity).toBe("valid");
  wire.commits[1].subject.entryIds.reverse();
  wire.entries.splice(1, 2, ...wire.entries.slice(1).reverse());
  expect((await verifyDocument(encoded(wire))).findings[0].code).toBe("HASH_MISMATCH");
  wire.commits[1].id = value(hashCommitSubject(wire.commits[1].subject));
  wire.head = wire.commits[1].id;
  expect((await verifyDocument(encoded(wire))).findings[0].code).toBe("SIGNATURE_INVALID");
});
test("P14/P15 correct signatures cannot repair linkage or selectors", async () => {
  for (const [modify, code] of [
    [
      (wire: Snapshot) => {
        wire.commits[1].subject.parent = `commit:${"0".repeat(64)}`;
      },
      "LINK_INVALID",
    ],
    [
      (wire: Snapshot) => {
        wire.entries[1].subject.parent = null;
      },
      "LINK_INVALID",
    ],
    [
      (wire: Snapshot) => {
        wire.commits[0].subject.parent = `commit:${"0".repeat(64)}`;
      },
      "LINK_INVALID",
    ],
  ] as const) {
    const wire = owner();
    modify(wire);
    resign(wire);
    expect((await verifyDocument(encoded(wire))).findings[0].code).toBe(code);
  }
});
test("P16 unsupported requirements and resource limits do not claim invalid cryptography", async () => {
  const raw = encoded(owner());
  for (const limits of [
    { maxBytes: raw.length - 1 },
    { maxCommits: 1 },
    { maxEntries: 1 },
    { maxCiphertextBytes: 1 },
    { maxDepth: 2 },
    { maxMetadataBytes: 1 },
  ])
    expect(await verifyDocument(raw, { limits })).toMatchObject({
      integrity: "unsupported",
      findings: [{ code: "RESOURCE_LIMIT" }],
    });
  expect(await verifyDocument(raw, { limits: { maxDepth: 0 } })).toMatchObject({
    integrity: "unsupported",
    findings: [{ code: "HOST_CONFIGURATION" }],
  });
  const wire = owner();
  wire.version = 2 as 1;
  expect((await verifyDocument(encoded(wire))).integrity).toBe("unsupported");
  const unknown = owner();
  Object.assign(unknown.entries[1].subject, { kind: "future" });
  resign(unknown);
  expect((await verifyDocument(encoded(unknown))).findings[0].code).toBe("ENTRY_KIND_UNSUPPORTED");
});
test("P17/P19 transport formatting, signed metadata and prototype keys", async () => {
  const wire = owner();
  wire.commits.at(-1)!.subject.metadata = JSON.parse(
    '{"__proto__":{"polluted":true},"unicode":"é"}',
  );
  resign(wire);
  expect(
    (await verifyDocument(new TextEncoder().encode(JSON.stringify(wire, null, 2)))).integrity,
  ).toBe("valid");
  expect(({} as { polluted?: boolean }).polluted).toBeUndefined();
  wire.commits.at(-1)!.subject.metadata!.unicode = "changed after signing";
  expect((await verifyDocument(encoded(wire))).findings[0].code).toBe("HASH_MISMATCH");
});
test("C01-C05 snapshot relationships have no implicit merge", async () => {
  const child = encoded(owner()),
    genesis = encoded(vector<Snapshot>("owner.genesis.document")),
    fork = encoded(vector<Snapshot>("owner.fork.document"));
  for (const [a, b, relation] of [
    [child, child, "equal"],
    [genesis, child, "behind"],
    [child, genesis, "ahead"],
    [child, fork, "diverged"],
    [fork, child, "diverged"],
  ] as const)
    expect(value(await compareSnapshots(a, b))).toBe(relation);
  const other = vector<Snapshot>("owner.genesis.document");
  other.commits[0].subject.nonce = base64(new Uint8Array(16).fill(12));
  resign(other);
  expect(value(await compareSnapshots(child, encoded(other)))).toBe("unrelated");
  expect(await compareSnapshots(child, new Uint8Array())).toMatchObject({ ok: false });
});

test("P15 duplicates, absent genesis, selectors and repeated per-commit nonces", async () => {
  const duplicate = owner();
  duplicate.commits.unshift(structuredClone(duplicate.commits[0]));
  expect((await verifyDocument(encoded(duplicate))).findings[0].code).toBe("DUPLICATE_RECORD");
  const missing = owner();
  missing.commits.shift();
  missing.entries.shift();
  expect((await verifyDocument(encoded(missing))).findings[0].code).toBe("LINK_INVALID");
  const wrong = owner();
  wrong.documentId = `commit:${"0".repeat(64)}`;
  expect((await verifyDocument(encoded(wrong))).findings[0].code).toBe("HEAD_INVALID");
  const repeated = owner(),
    extra = structuredClone(repeated.entries[1]);
  if (extra.subject.kind !== "application") throw new Error("fixture");
  protectedPayload(extra.subject).ciphertext = "AA";
  repeated.entries.push(extra);
  repeated.commits[1].subject.entryIds.push(extra.id);
  resign(repeated);
  expect((await verifyDocument(encoded(repeated))).findings[0].code).toBe("SCHEMA_INVALID");
});

test("P19 large bounded metadata and exact integral number token import", async () => {
  const wire = owner();
  wire.commits.at(-1)!.subject.metadata = { items: Array.from({ length: 5000 }, (_, i) => i) };
  resign(wire);
  expect((await verifyDocument(encoded(wire))).integrity).toBe("valid");
  const raw = new TextEncoder().encode(
    new TextDecoder().decode(encoded(wire)).replace('"version":1', '"version":1.0e0'),
  );
  expect((await verifyDocument(raw)).integrity).toBe("valid");
});

test("P11 a detached commit cannot hide beside the selected chain", async () => {
  const wire = owner(),
    fork = vector<Snapshot>("owner.fork.document");
  fork.entries[1].subject.nonce = base64(new Uint8Array(16).fill(27));
  resign(fork);
  expect((await verifyDocument(encoded(fork))).integrity).toBe("valid");
  wire.commits.push(fork.commits[1]);
  wire.entries.push(fork.entries[1]);
  expect((await verifyDocument(encoded(wire))).findings[0].code).toBe("UNREFERENCED_RECORD");
});

test("Concord validates signed genesis requirements after Ledger integrity succeeds", async () => {
  for (const mode of ["missing", "invalid"] as const) {
    const raw = vector<Snapshot>("owner.genesis.document");
    if (mode === "missing") raw.commits[0].subject.metadata = {};
    else
      (
        raw.commits[0].subject.metadata!.concord as import("../src/index.js").Declaration
      ).model.version = 0;
    const bytes = encoded(resign(raw));
    expect((await verifyLedger(bytes)).integrity).toBe("valid");
    expect(await verifyDocument(bytes)).toMatchObject({
      integrity: "invalid",
      findings: [{ code: mode === "missing" ? "DECLARATION_INVALID" : "SCHEMA_INVALID" }],
    });
  }
});

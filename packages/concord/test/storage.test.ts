import { expect, test, vi } from "vite-plus/test";
import { identityFromSeed, type IdentityCapability } from "@ternent/armour";
import { createDocument, openDocument, type CommitId, type Snapshot } from "../src/index.js";
import { compareSnapshots, verifyDocument } from "../src/protocol/index.js";
import { createStandardSystemProfile } from "../src/system/index.js";
import {
  createMemoryArtifactStore,
  createMemoryExpectedHeadStore,
  registerModel,
} from "../src/testing/index.js";
import { encoded, resign, seed } from "./fixtures.js";

function value<T>(result: { ok: true; value: T } | { ok: false; error: { code: string } }): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const failure = (code: string) => ({ ok: false, error: { code, phase: "storage" } });
const ownerIdentity = async () => value(await identityFromSeed(seed));
const head = (bytes: Uint8Array): CommitId =>
  (JSON.parse(new TextDecoder().decode(bytes)) as Snapshot).head;
const create = async (identity: IdentityCapability) =>
  value(
    await createDocument({
      identity,
      model: registerModel,
      system: createStandardSystemProfile(),
    }),
  );
const open = (
  bytes: Uint8Array,
  signer: IdentityCapability,
  mode: "immediate" | "draft" = "immediate",
  anchor?: Uint8Array,
) =>
  openDocument({
    bytes,
    signer,
    mode,
    anchor,
    model: registerModel,
    system: createStandardSystemProfile(),
  });
type ExpectedStore = ReturnType<typeof createMemoryExpectedHeadStore>;
async function conflict(store: ExpectedStore, bytes: Uint8Array, expected: CommitId | null) {
  const result = await store.writeExpected(bytes, expected);
  expect(result).toMatchObject(failure("HEAD_CONFLICT"));
  if (result.ok || result.error.code !== "HEAD_CONFLICT") throw new Error("Expected head conflict");
  expect(Object.hasOwn(result.error, "details")).toBe(false);
  return result.error.remote;
}

async function branches() {
  const owner = await ownerIdentity();
  const document = await create(owner);
  const base = document.export();
  const left = await open(base, owner);
  const right = await open(base, owner);
  value(await left.dispatch("set", { value: "left branch" }));
  value(await right.dispatch("set", { value: "right branch" }));
  return { owner, base, left, right };
}

test("raw memory stores copy buffers and do not turn stored bytes into trusted state", async () => {
  for (const store of [createMemoryArtifactStore(), createMemoryExpectedHeadStore()]) {
    expect(value(await store.read())).toBeNull();
    const input = new Uint8Array([1, 2, 3]);
    const writing = store.write(input);
    input.fill(99);
    value(await writing);
    const first = value(await store.read())!;
    expect(first).toEqual(new Uint8Array([1, 2, 3]));
    first.fill(77);
    expect(value(await store.read())).toEqual(new Uint8Array([1, 2, 3]));
    const untrusted = await open(value(await store.read())!, await ownerIdentity());
    expect(untrusted.state()).toEqual({ status: "inspection", reason: "invalid" });
    expect((await untrusted.verify()).integrity).toBe("invalid");
  }
});

test("expected-head create is explicit and conflict snapshots are detached outside JSON details", async () => {
  const { base, left, right } = await branches();
  const store = createMemoryExpectedHeadStore();
  expect(store.expectedHead).toBe(true);
  const absent = await conflict(store, left.export(), head(base));
  expect(absent).toBeNull();
  value(await store.writeExpected(base, null));
  const remote = await conflict(store, left.export(), null);
  expect(remote).toEqual(base);
  remote!.fill(0);
  expect(value(await store.read())).toEqual(base);
  const next = value(await store.read())!;
  next.fill(0);
  const again = await conflict(store, right.export(), null);
  expect(again).toEqual(base);
});

test("competing create-only writes install exactly one complete artifact", async () => {
  const owner = await ownerIdentity();
  const first = (await create(owner)).export();
  const second = (await create(owner)).export();
  const store = createMemoryExpectedHeadStore();
  const attempts = await Promise.all([
    store.writeExpected(first, null),
    store.writeExpected(second, null),
  ]);
  expect(attempts.filter(({ ok }) => ok)).toHaveLength(1);
  const winner = value(await store.read())!;
  expect([head(first), head(second)]).toContain(head(winner));
  const rejected = attempts.find((attempt) => !attempt.ok)!;
  if (rejected.ok || rejected.error.code !== "HEAD_CONFLICT")
    throw new Error("Expected losing create conflict");
  expect(rejected.error.remote).toEqual(winner);
  expect((await verifyDocument(winner)).integrity).toBe("valid");
});

test("competing expected writes retain both divergent local documents and expose the winning remote", async () => {
  const { base, left, right } = await branches();
  const store = createMemoryExpectedHeadStore();
  value(await store.writeExpected(base, null));
  const originals = [left.export(), right.export()];
  const attempts = await Promise.all(
    originals.map((bytes) => store.writeExpected(bytes, head(base))),
  );
  expect(attempts.filter(({ ok }) => ok)).toHaveLength(1);
  const winner = value(await store.read())!;
  const losingIndex = attempts.findIndex((attempt) => !attempt.ok);
  const rejected = attempts[losingIndex];
  if (rejected.ok || rejected.error.code !== "HEAD_CONFLICT")
    throw new Error("Expected losing write conflict");
  expect(rejected.error.remote).toEqual(winner);
  expect(value(await compareSnapshots(originals[losingIndex], winner))).toBe("diverged");
  expect(left.export()).toEqual(originals[0]);
  expect(right.export()).toEqual(originals[1]);
  expect(left.state()).toMatchObject({ projection: { value: "left branch" } });
  expect(right.state()).toMatchObject({ projection: { value: "right branch" } });
});

test("unconditional and expected writes share one transaction queue", async () => {
  const { owner, base, left, right } = await branches();
  const store = createMemoryExpectedHeadStore();
  value(await store.writeExpected(base, null));
  const laterLeft = await open(left.export(), owner);
  value(await laterLeft.dispatch("set", { value: "later left" }));
  const conditional = store.writeExpected(left.export(), head(base));
  const unconditional = store.write(right.export());
  const afterUnconditional = store.writeExpected(laterLeft.export(), head(left.export()));
  const [first, second, third] = await Promise.all([
    conditional,
    unconditional,
    afterUnconditional,
  ]);
  value(first);
  value(second);
  expect(third).toMatchObject(failure("HEAD_CONFLICT"));
  if (third.ok || third.error.code !== "HEAD_CONFLICT") throw new Error("Expected queued conflict");
  expect(third.error.remote).toEqual(right.export());
  expect(value(await store.read())).toEqual(right.export());
});

test("expected writes capture candidate bytes at invocation and reads cannot mutate later checks", async () => {
  const { base, left } = await branches();
  const store = createMemoryExpectedHeadStore();
  const first = new Uint8Array(base);
  const creating = store.writeExpected(first, null);
  first.fill(0);
  value(await creating);
  const candidate = left.export();
  const writing = store.writeExpected(candidate, head(base));
  candidate.fill(0);
  value(await writing);
  expect(value(await store.read())).toEqual(left.export());
  const external = value(await store.read())!;
  external.fill(0);
  expect((await verifyDocument(value(await store.read())!)).integrity).toBe("valid");
});

test("invalid candidates and expected arguments fail atomically without changing stored bytes", async () => {
  const { base, left } = await branches();
  const store = createMemoryExpectedHeadStore();
  value(await store.writeExpected(base, null));
  const corrupt = JSON.parse(new TextDecoder().decode(left.export())) as Snapshot;
  corrupt.commits.at(-1)!.signature = "A".repeat(86);
  const malformed = [
    new Uint8Array([1, 2]),
    new TextEncoder().encode(JSON.stringify(corrupt)),
    null as unknown as Uint8Array,
  ];
  for (const bytes of malformed) {
    expect(await store.writeExpected(bytes, head(base))).toMatchObject(failure("STORAGE_FAILED"));
    expect(value(await store.read())).toEqual(base);
  }
  for (const expected of [undefined, "not a commit", {}, `commit:${"G".repeat(64)}`]) {
    expect(await store.writeExpected(left.export(), expected as CommitId)).toMatchObject(
      failure("STORAGE_FAILED"),
    );
    expect(value(await store.read())).toEqual(base);
  }
  value(await store.writeExpected(left.export(), head(base)));
});

test("corrupt current bytes block expected writes and remain readable as raw evidence", async () => {
  const { base, left } = await branches();
  const store = createMemoryExpectedHeadStore();
  const corrupt = new Uint8Array([7, 8, 9]);
  value(await store.write(corrupt));
  for (const expected of [null, head(base)]) {
    expect(await store.writeExpected(left.export(), expected)).toMatchObject(
      failure("STORAGE_FAILED"),
    );
    expect(value(await store.read())).toEqual(corrupt);
  }
  const evidence = await open(value(await store.read())!, await ownerIdentity());
  expect(evidence.export()).toEqual(corrupt);
  expect(evidence.state()).toEqual({ status: "inspection", reason: "invalid" });
});

test("an expected-head adapter does not infer rollback or document-selection policy", async () => {
  const { owner, base, left } = await branches();
  const store = createMemoryExpectedHeadStore();
  value(await store.writeExpected(left.export(), null));
  expect(value(await compareSnapshots(base, left.export()))).toBe("behind");
  value(await store.writeExpected(base, head(left.export())));
  expect(value(await store.read())).toEqual(base);
  const unrelated = (await create(owner)).export();
  expect(value(await compareSnapshots(unrelated, base))).toBe("unrelated");
  value(await store.writeExpected(unrelated, head(base)));
  expect(value(await store.read())).toEqual(unrelated);
});

test("remembered heads reject stored rollback while unanchored older history remains valid", async () => {
  const { owner, base, left } = await branches();
  const store = createMemoryExpectedHeadStore();
  value(await store.writeExpected(left.export(), null));
  const anchor = value(await store.read())!;
  value(await store.writeExpected(base, head(anchor)));
  const older = value(await store.read())!;
  const anchored = await open(older, owner, "immediate", anchor);
  expect(anchored.state()).toEqual({ status: "inspection", reason: "freshness" });
  expect(anchored.inspect().findings).toMatchObject([{ code: "STALE_HEAD" }]);
  expect(anchored.inspect().verification.integrity).toBe("valid");
  expect(anchored.export()).toEqual(older);
  const unanchored = await open(older, owner);
  expect(unanchored.state()).toMatchObject({ status: "ready", projection: { value: "" } });
  expect(unanchored.inspect().freshness).toBe("unanchored");
});

test("dispatch and local drafts do not publish, and reopen reconstructs committed bytes only", async () => {
  const owner = await ownerIdentity();
  const store = createMemoryExpectedHeadStore();
  const immediate = await create(owner);
  value(await immediate.dispatch("set", { value: "committed locally" }));
  expect(value(await store.read())).toBeNull();
  const draft = await open(immediate.export(), owner, "draft");
  value(await draft.dispatch("set", { value: "pending locally" }));
  const staged = draft.draft();
  expect(value(await store.read())).toBeNull();
  value(await store.writeExpected(draft.export(), null));
  expect(draft.draft()).toEqual(staged);
  const reopened = await open(value(await store.read())!, owner, "draft");
  expect(reopened.state()).toMatchObject({ projection: { value: "committed locally" } });
  expect(reopened.draft()).toBeNull();
  expect(draft.draft()!.preview).toEqual({ value: "pending locally" });
});

test("external failed I/O preserves the local committed artifact and pending draft", async () => {
  const owner = await ownerIdentity();
  const document = await create(owner);
  value(await document.dispatch("set", { value: "local commit" }));
  const draft = await open(document.export(), owner, "draft");
  value(await draft.dispatch("set", { value: "pending after local commit" }));
  const before = draft.export();
  const state = draft.state();
  const pending = draft.draft();
  const write = vi.fn(async (_bytes: Uint8Array) => ({
    ok: false as const,
    error: { code: "STORAGE_FAILED" as const, phase: "storage" as const, message: "offline" },
  }));
  expect(await write(draft.export())).toMatchObject(failure("STORAGE_FAILED"));
  expect(write).toHaveBeenCalledOnce();
  expect(draft.export()).toEqual(before);
  expect(draft.state()).toEqual(state);
  expect(draft.draft()).toEqual(pending);
  value(await draft.commit());
  expect(draft.state()).toMatchObject({ projection: { value: "pending after local commit" } });
});

test("protocol head verification is independent of installed model support and profile authority", async () => {
  const owner = await ownerIdentity();
  const other = value(await identityFromSeed(new Uint8Array(32).fill(2)));
  const original = (await create(owner)).export();
  for (const mode of ["unknown-model", "unknown-system", "invalid-owner"] as const) {
    const snapshot = JSON.parse(new TextDecoder().decode(original)) as Snapshot;
    if (mode === "unknown-model")
      snapshot.commits[0].subject.declaration!.model = { id: "concord.unavailable", version: 1 };
    else if (mode === "unknown-system")
      snapshot.commits[0].subject.declaration!.system = { id: "concord.unavailable", version: 1 };
    else {
      const entry = snapshot.entries[0].subject;
      if (entry.kind !== "system") throw new Error("Expected system genesis");
      entry.payload.data.owner = other.publicIdentity;
    }
    const bytes = encoded(resign(snapshot));
    expect((await verifyDocument(bytes)).integrity).toBe("valid");
    const store = createMemoryExpectedHeadStore();
    value(await store.writeExpected(bytes, null));
    expect(value(await store.read())).toEqual(bytes);
    const opened = await open(value(await store.read())!, owner);
    expect(opened.state()).toEqual({
      status: "inspection",
      reason: mode === "invalid-owner" ? "invalid" : "incompatible",
    });
    expect(opened.inspect().findings).toMatchObject([
      { code: mode === "invalid-owner" ? "SYSTEM_EVENT_INVALID" : "REQUIREMENT_UNAVAILABLE" },
    ]);
    expect(opened.export()).toEqual(bytes);
  }
});

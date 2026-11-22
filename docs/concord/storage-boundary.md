# Storage boundary and expected-head publication

Implemented B12 reference proof, 2026-11-20. Storage reads and writes complete byte
artifacts. Commit authoring is a separate local operation; the runtime does not know
about a store, publish on dispatch, persist drafts or roll back a commit after a save
failure. Existing Identity/Armour cryptography and Concord verification/replay remain
the trust boundary.

## Minimal adapter and optional capability

`@ternent/concord/testing` exports these types and in-memory reference helpers:

```ts
type StorageError =
  | { code: "STORAGE_FAILED"; phase: "storage"; message: string }
  | { code: "HEAD_CONFLICT"; phase: "storage"; message: string; remote: Uint8Array | null };
type ArtifactStore = {
  read(): Promise<Result<Uint8Array | null, StorageError>>;
  write(bytes: Uint8Array): Promise<Result<void, StorageError>>;
};
type ExpectedHeadArtifactStore = ArtifactStore & {
  readonly expectedHead: true;
  writeExpected(bytes: Uint8Array, expected: CommitId | null): Promise<Result<void, StorageError>>;
};
```

`createMemoryArtifactStore()` is the existing raw byte store. It copies on write/read
and does not verify or interpret its contents. Empty storage is null; a zero-length
artifact is still an artifact. A successful write is not evidence that a document is
valid, authorized, decryptable, current or complete.

`createMemoryExpectedHeadStore()` adds an atomic compare-and-write reference for
writers sharing that instance. It verifies candidate and stored protocol history with
default protocol limits, then compares the stored head with the expected head before
replacement. Null means create only if absent. An omitted, malformed or noncanonical
expected head fails `STORAGE_FAILED`; it never becomes an unconditional write.

All mutations, including unconditional `write`, share a serialized queue. Validation,
comparison and replacement occupy one operation; another write cannot interleave
while verification awaits. Inputs are copied at invocation, reads/conflict bytes are
copied at return, and reads observe the last published artifact while a write is
pending. Exactly one of two new child heads using the same old expected head can
succeed. On mismatch, `HEAD_CONFLICT` returns a detached copy of the stored bytes (or
null if absent) without altering storage. `remote` is separate byte evidence, not a
JSON error-details field or an exception message.

Malformed/unsupported candidates, corrupt stored artifacts and invalid arguments fail
`STORAGE_FAILED` without replacement. Read the stored raw bytes to inspect corrupt
content; do not silently erase it because head lookup failed. A failed operation does
not poison the mutation queue. The richer store's ordinary `write` is deliberately
unconditional and remains a raw byte operation; callers wanting compare-and-write
must use `writeExpected`.

The richer store's protocol check only establishes a verified head for comparison.
It never resolves model/profile code or proves their semantics. A cryptographically
valid artifact with unknown requirements or invalid authority can be stored and still
open as incompatible/invalid inspection. Always open and replay under the host's
chosen model/system/capabilities before exposing trusted application state.

## Caller flow and conflict evidence

Export once to capture the committed local candidate, then explicitly publish it.
When replacing a known stored head, pass that remembered head as expected. Keep the
candidate until the operation completes. With pending draft work, export still
contains committed history only. Saving and reopening cannot persist that draft.

On conflict, retain local and returned remote bytes. Verify/compare them using
`compareSnapshots(localBytes, remoteBytes)` when remote is present. Equal/ahead/behind/
diverged/unrelated describe the two snapshots; they do not select one. A missing or
invalid remote is separate evidence, not permission to overwrite. The runtime does
not merge, import over an existing handle, retry a different expected head or choose
a winner automatically. Open another handle for a chosen snapshot.

```ts
const localBytes = document.export();
const result = await store.writeExpected(localBytes, rememberedHead);
if (!result.ok && result.error.code === "HEAD_CONFLICT") {
  const remoteBytes = result.error.remote;
  const relation = remoteBytes === null ? null : await compareSnapshots(localBytes, remoteBytes);
  // Retain localBytes and remoteBytes for explicit inspection/selection.
}
```

An adapter's expected-head match does not enforce document identity or ancestry. If a
caller deliberately supplies the actual current head, it can publish a valid older,
divergent or unrelated candidate. The reference store adds no hidden replacement
policy. Expected-head checks prevent routine stale writes; anchors detect stale reads.
An old valid snapshot can still open unanchored. Opening with a remembered full newer
snapshot rejects rollback as `STALE_HEAD` and retains the bytes for inspection.

Expected head is not a byte revision: transport whitespace/key ordering can change
while retaining the same head, and an away-and-back sequence is not detected by this
token alone. All Ledger subject metadata is signed. A host needing byte-revision
distinctions must use a provider revision/ETag or a stronger transaction contract.
No freshness protection can be inferred from success when the host forgot its anchor.

## Scope of the proof

The new helper is a volatile reference, not a production filesystem or network adapter.
Atomicity applies only to writers using the same instance; it does not coordinate
other processes or independent instances. A real adapter advertising this capability
must use its storage transaction/conditional-write primitive. A client-side read then
ordinary write cannot establish atomic expected-head protection.

The former handshake app is retired. The reference helper and public tests retain
the library conflict, fork, anchor and failure-preservation checks. No transport,
persistence provider, storage framework, new subpath or runtime storage option is
introduced here.

Source cases live in `packages/concord/test/storage.test.ts`; external Node/browser
consumers exercise the public package. The
[repository guide](../engineering/repository-hygiene.md#acceptance-boundaries) identifies
acceptance reports and their limits.

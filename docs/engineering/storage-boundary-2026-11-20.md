# Storage boundary and conflict proof

B12 implementation, 2026-11-20. Explicit storage publication is now covered by a
small reusable adapter contract, reference expected-head store and external consumers.
Concord runtime lifecycle, cryptography, group rules and draft implementation are
unchanged. See [the storage contract](../concord/storage-boundary.md) for exact types,
caller flow and limits.

## Delivered behaviour

The existing `createMemoryArtifactStore` keeps its simple copied-byte read/write
behaviour. New `createMemoryExpectedHeadStore` advertises `expectedHead: true` and
adds `writeExpected(bytes, expectedHead)`, with explicit null for create-only. Shared
mutation serialization keeps async protocol verification, head comparison and
replacement in one operation, including unconditional writes. Concurrent new branches
using the same old expected head produce one success and one `HEAD_CONFLICT`.

Conflict errors contain detached `remote` bytes outside JSON error details. Reads and
input buffers are copied as well. The losing local snapshot remains exportable and
can be compared with the returned remote; valid forks remain separate/divergent.
No automatic head selection, import, merge, overwrite retry or local commit rollback
is introduced. Corrupt current bytes block conditional replacement and remain
available as raw evidence. Invalid input/candidate or lookup failure yields sanitized
`STORAGE_FAILED` without poisoning later operations.

Storage is still external: dispatch and commit do not save. Publishing an export
with a pending draft saves only committed history. A failed adapter write leaves the
local committed artifact/projection and pending preview unchanged. Reopening a saved
artifact reconstructs the committed state and starts without local draft work.
A remembered newer snapshot rejects an older returned snapshot as `STALE_HEAD`;
the same valid old snapshot can still open unanchored.

## Scope and ownership

New source is `packages/concord/src/testing/artifact-store.ts`, re-exported from the
existing `/testing` entry. It also exports `ArtifactStore`, `ExpectedHeadArtifactStore`
and the discriminated `StorageError` union. Existing error codes are reused. No new
package, dependency, export subpath, filesystem/network provider or runtime storage
option is added. Basic raw writes remain unconditional and do not establish trust.

Conditional writes protocol-verify candidate/current only to bind the compared head,
using default verifier limits. Protocol-valid unknown requirements or invalid system
authority still produce incompatible/invalid runtime open. Storage never resolves
models/profiles or certifies application semantics. Expected-head comparison is not
an ancestry/replacement policy, a byte revision or read freshness protection.
Explicitly matching the actual head can still replace with an older/unrelated valid
snapshot; callers retain responsibility for that deliberate selection.

Atomicity is limited to writers sharing the reference instance. A production adapter
must use a real provider transaction/conditional write; a non-atomic client read then
write cannot advertise this guarantee. The reference is volatile and does not
coordinate processes. The existing handshake's filesystem hard-link publication
remains separate create-only evidence, not a general expected-head update provider.

## Verification evidence

`packages/concord/test/storage.test.ts` has 13 public-behaviour tests covering buffer
isolation; competing create/expected writes; unconditional-write interposition;
invalid arguments/candidates/corrupt stored bytes; exact conflict evidence; retained
forks; explicit replacement policy; anchored/unanchored rollback; committed-only
publish/reopen; injected failed I/O; and protocol-valid but application-unusable
stored artifacts. No system/model code is executed to look up the stored head.

Packed Node 22/24 consumers additionally race real branch exports, compare the losing
artifact with returned bytes, reopen stored history, retain drafts through an injected
write failure and prove anchor handling. Published declarations distinguish basic vs
expected-head stores and narrow conflict evidence, with intended compile errors for
missing expected heads, text buffers and mutable capability flags. Browser proof adds
create-only expected-head storage and saved-document reopen to the existing fixture.

Verification used pinned Node 24.21.0 / pnpm 10.33.4:

| Check                                            | Result                                                                                         |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Root behaviour suite                             | 165 tests passed in 17 files, including 13 storage tests                                       |
| Built handshake CLI/MCP smoke                    | 2 tests passed                                                                                 |
| Contract, formatting, build and typed lint       | Passed                                                                                         |
| Tooling, root, fixture and product TS/Vue scopes | Passed                                                                                         |
| Installed Node 22.18.0 / 24.21.0                 | Storage race/conflict/fork/anchor/draft checks and earlier primitive/group/draft checks passed |
| Installed declarations                           | Passed, including storage capability and conflict-evidence types                               |
| External library and production Vue builds       | Passed                                                                                         |
| Chromium execution                               | Blocked at launch by macOS Mach port permission denial                                         |

The full root gate run passes its first ten gates and exits nonzero only in consumers
at Chromium launch (`bootstrap_check_in ... Permission denied (1100)`). Browser assertions
and the portable feedback checks after that step were not reached. The browser fixture
builds; no browser execution is claimed and no gate/assertion was bypassed.
A separate read-only review of the source change found no concrete issues.

The exercised Concord candidate SHA-256 was
`c56f034d3f807a789361d731c88e0550dec51fa408d4c4e37b13b21e3a6fbd70`.
Machine-local evidence is in `artifacts/pilot-check.json` and
`artifacts/pilot-consumers.json`. These checks are not release receipts, and the earlier
GitHub checkpoint's CI result does not certify this newer increment.

## Following work

The Concord group, draft and reusable storage slices are now implemented locally.
Seal/UI activation, full product verification, release planning and registry publication
remain their existing backlog items. No new remote CI result, npm publication,
deployment or performance measurement is claimed by this proof.

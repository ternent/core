# Draft authoring

B05 implementation, 2026-11-20. Follow-up: [B12 now implements the storage reference proof](storage-boundary-2026-11-20.md);
the remaining-scope observations below describe the earlier draft slice. `mode: "draft"` is now functional for create/open.
Immediate commits remain the default. This extends the existing runtime authoring
path; it does not add storage publication, a new wire format or a second crypto path.

## Delivered behaviour

Genesis is always committed immediately. In draft mode, dispatch validates inputs,
selects one audience, checks its current signer permissions and validates emitted
events. It reduces those events against the previous provisional preview and stages
immutable application intents. Subsequent decisions receive that preview. A failed
command retains all previously successful staged work.

`draft()` returns `{ baseHead, entryCount, preview }`. State, inspection, export,
verification and replay continue to describe committed history. Drafts have no protocol
entry/commit IDs, nonces, ciphertext or signature. Their plaintext is volatile local
memory and is excluded from exports; reopening an export starts without a draft.
A null JSON preview is preserved as a real state, without falling back to committed
projection. A scoped base keeps the same hidden-entry limitations in its preview.

`commit(metadata?)` passes the entire ordered batch through the existing system
protection, commit signing, full protocol verification and two-stage replay. Several
commands may select different groups in one batch; each command still selects exactly
one audience. Only a successful candidate atomically publishes snapshot, projection,
inspection and coverage, and clears the draft. Preparation, encryption/authentication,
signing, resource or late model failures retain committed bytes/state and the complete
draft for an explicit retry. No implicit retry or storage write occurs.

Metadata is copied when commit is invoked, before queueing; it must be a valid JSON
object within the configured metadata bound. It is public and included in the signed
commit subject. Omission is null. Invalid metadata fails before protection/signing.
Staged counts include committed history when checking entry and prospective commit
limits. Aggregate intents and each preview are independently JSON byte/depth bounded.
Encrypted snapshot/ciphertext bounds are checked at commit; a valid preview does not
promise the final encrypted artifact will fit.

`discardDraft()` removes only staged work. An empty/immediate-mode commit returns
`NO_DRAFT`; empty discard succeeds on a writable handle. Read-only/inspection guards
remain in place. Operations are serialized in invocation order. During pending signing,
reads expose committed state and the existing draft. Synchronous model reentry is
rejected; the async-profile host contract from ADR 0014 remains unchanged.

Specialist group/membership helpers require immediate mode: a draft handle returns
`DRAFT_PENDING` when it has staged work and `HOST_CONFIGURATION` when empty. No implicit
mode switch occurs. Perform management on an immediate handle, then open its exported
snapshot in the desired authoring mode.

## Implementation and evidence

Production change is scoped to `packages/concord/src/runtime.ts`: functional mode
validation, private staged intents/preview, provisional reduction, queued commit/discard,
signed metadata and atomic draft clearing in the existing publication block. Existing
model/handle types already described this API. No new production dependency or public
package/subpath is added. Identity, Armour/typage and system membership remain owners of
their existing responsibilities.

`packages/concord/test/drafts.test.ts` tests public behaviour, including a model that
encodes the previous value in each event so ordered preview/replay is observable.
It covers staged-only reads, cross-group batching, detachment, system/read-only guards,
resource limits, failure/retry, null states, metadata capture and queued/reentrant calls.
A scoped-reader integration proves group-only writers can commit while hidden entries
retain explicit locked markers/coverage and denied routes leave their draft intact.
The earlier runtime test now accepts draft creation while still rejecting alternative
profile declarations. Original Identity/age/protocol fixed artifacts are unchanged.

Installed Node 22/24 consumers now check staged-only replay/export, signed metadata,
discard/reopen, ordered cross-group batches and retry after an injected signing failure.
Declaration checks retain typed previews/receipts and deliberate errors. Browser proof
includes draft staging/commit/reopen in the existing package-consumer fixture; it does
not add a product application.

Verification used pinned Node 24.21.0 / pnpm 10.33.4:

| Check                                            | Result                                                                                                                  |
| ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Final root behaviour suite                       | 152 tests passed in 16 files, including 15 draft tests                                                                  |
| Built handshake CLI/MCP smoke                    | 2 tests passed                                                                                                          |
| Contract, formatting, build and typed lint       | Passed                                                                                                                  |
| Tooling, root, fixture and product TS/Vue scopes | Passed                                                                                                                  |
| Installed Node 22.18.0 / 24.21.0                 | Draft lifecycle, signed metadata, cross-group batching, retry, original primitives/groups and protocol isolation passed |
| Installed declarations                           | Passed, including preview/receipt/metadata type checks                                                                  |
| External library and production Vue builds       | Passed                                                                                                                  |
| Chromium execution                               | Blocked at launch by macOS Mach port permission denial                                                                  |

The full root gate run passes its first ten gates and exits nonzero only in the
consumer gate at Chromium launch (`bootstrap_check_in ... Permission denied (1100)`).
It ran 151 behaviour tests before the final scoped-reader regression was added;
the final behaviour rerun passes all 152. The added regression also passed Concord
typecheck and typed lint. Browser assertions and the portable feedback checks placed
after browser execution were not reached. Browser proof builds; execution is not
claimed. No assertion or gate was bypassed to report this limitation.

The exercised Concord candidate SHA-256 was
`4c90985a8b12456c8bfbdc12448c6f187f0c663dbdc94c21be58977ae90f723b`.
Machine-local check/candidate details are in `artifacts/pilot-check.json` and
`artifacts/pilot-consumers.json`; they are verification output, not release receipts.
A separate read-only review of the production draft delta found no concrete issues.

## Remaining scope

B12 is the reusable external storage/expected-head conflict proof. Commit and storage
publication remain separate; drafts do not persist themselves. Seal/UI activation,
complete candidate verification and release automation/publication retain their backlog
scope. No new remote CI result, npm publication, deployment or performance measurement
is claimed here.

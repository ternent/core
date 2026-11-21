# Independent groups and readable replay

B03/B04 implementation, 2026-11-20. Follow-up: [B05 now implements drafts](draft-authoring-2026-11-20.md);
the checks and remaining-scope observations below describe the earlier group slice. The default `document` group and additional
privacy groups now have separate membership, authority and encryption epochs.
This is a pre-release revision of standard profile 1. The existing owner-only signed
vectors remain byte-for-byte unchanged; no old-runtime compatibility is promised.

## Behaviour delivered

- A default-group writer can create a group without owner approval. The creator
  gets all four capabilities; the default owner gets no implicit access or control.
- Members can join a group without joining `document`. Removing default membership
  leaves their other group rights and keys intact. Each application command selects
  one audience; every emitted event must select that same audience.
- Admission/re-admission includes every historical epoch key for the selected group.
  Removal rotates only that group, with wraps to exactly its remaining members.
  Retained old keys/plaintext stay readable; new epochs stay locked until granted.
- Replay verifies complete reachable history and validates every public authority
  transition before decryption/model callbacks. Available-key authentication/context
  failures remain invalid; missing keys produce explicit locked markers.
- A model requires all events unless it implements `reduceLocked`. That hook receives
  only the public marker and historical audience-scoped facts. A failed hook or later
  readable transition publishes no intermediate trusted projection.
- Ready state and `replay()` now both include coverage and exact locked count.
  `replay()` returns `{ projection, coverage, lockedEntries }`. Complete coverage has
  zero locked entries; readable coverage reports application status `scoped` and
  never certifies hidden application semantics.
- Inspection exposes ordered readable/locked entries and public audience summaries
  after a successful complete system pass, including when model replay later fails.
  Profile output is checked for exact entry coverage, signer/audience binding and
  closed nested member/epoch records before publication. Identity validation is
  cached within that output-validation pass.

## Ownership and public API

The existing system implementation owns group keys, wraps, epochs and membership;
Identity/Armour still own cryptography. Armour continues to use typage through
`age-encryption@0.3.1`, without WASM or an initialization lifecycle. There is one
application encryption operation per entry, to its chosen group/epoch. No benchmark
or measured speed/size gain is claimed.

`@ternent/concord/system` adds `createGroup(handle)`. Member helpers accept optional
`audience`, defaulting to `document` only when omitted. Application models may add
command `audience(input)`, event `audience(event)` and `reduceLocked`. Defaults retain
document-only routing. Mixed routing fails before protection/signing.

Group IDs, membership/capability changes, signers, wrap targets, epochs/recipients,
linkage, sizes/counts and signed commit metadata remain public. Group names and
descriptions belong in encrypted application data. No metadata-hiding guarantee,
trial-decryption routing, anonymous envelope or automatic owner self-grant is added.

Primary code: `packages/concord/src/{runtime,model/types,protocol/types,protocol/schema}.ts`
and `src/system/{types,standard,audience,authoring,index}.ts`. The existing handshake
consumer changes only its historical facts and unavailable-key smoke expectation.
No new product application is introduced.

## Fixed evidence and checks

The original Identity/age/protocol owner vectors are unchanged. New fixed
`groups.removed.document.json` and `groups.readmitted.document.json` snapshots hold
two groups, an owner outside both, independent default removal, group rotation and
full-history readmission. Literal expected results cover three readers at both heads.
They were authored once; built-in Node crypto separately checked all hashes and
Ed25519 signatures. Expectations were constructed from the intended six application
events, not generated from replay. See [vector provenance](../concord/vectors/README.md).

`packages/concord/test/groups.test.ts` covers independent permissions, historical
access, routing/atomicity, opted-in/full models, saved-byte determinism, signed
semantic failures, cross-group substitution, tampering before callbacks and malformed
profile streams. Existing membership/runtime tests retain their failure coverage
while adopting the new public result shape and retained-history behaviour.

Installed candidate consumers exercise the fixed group vectors and public authoring
on Node 22.18.0 and 24.21.0 outside the workspace. Published declaration checks include
group helpers, nullable/invalid types, coverage wrapping and locked-marker narrowing.
The browser fixture now also proves independent group access and scoped replay.

Verification used pinned Node 24.21.0 / pnpm 10.33.4:

| Check                                                     | Result                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Root behaviour suite                                      | 137 tests passed in 15 files, including 19 group tests                          |
| Built handshake CLI/MCP artifact smoke                    | 2 tests passed                                                                  |
| Contract, format, build, typed lint and all TS/Vue scopes | Passed                                                                          |
| Installed candidate Node 22.18.0 / 24.21.0                | Primitive, Concord, fixed-group, authoring and protocol-isolation checks passed |
| Installed declarations                                    | Passed, including intended TypeScript errors and locked-marker narrowing        |
| External library and production Vue build                 | Passed                                                                          |
| Chromium execution                                        | Blocked at launch by macOS Mach port permission denial                          |

The first full run caught the handshake smoke's stale `READ_ACCESS_REQUIRED`
expectation for an uninvited reader. The contract now distinguishes absent reader
from missing keys; its expectation is `KEY_UNAVAILABLE`. Both smoke tests passed
after that update. A read-only review then found the nested profile-output boundary
gap; strict validation and a regression covering 24 malformed nested outputs pass.
The final root gate run passes its first ten gates and exits nonzero in consumers
only at Chromium launch (`bootstrap_check_in ... Permission denied (1100)`).
The behaviour suite was rerun after the final regression addition: 137/137 passed.
Browser assertions and the portable feedback checks located after browser execution
were not reached. The browser fixture builds; execution is not claimed.

The final exercised Concord candidate SHA-256 was
`16aed74abc175cc2e7af16eda049d6d380e09238e173eebcdfcce64b096a7b2f`.
Machine-local gate/candidate evidence is in `artifacts/pilot-check.json` and
`artifacts/pilot-consumers.json`. They are verification outputs, not release receipts.
This increment has no remote CI result; the earlier PR checkpoint's success does
not certify these later edits.

## Remaining work

B05 draft mode is still unimplemented: requesting it returns `HOST_CONFIGURATION`.
Cross-audience atomic batches will combine separate commands through that later mode.
The reusable expected-head storage conflict proof follows it. Seal/UI activation,
complete candidate-set verification and release publication remain their existing
backlog items. No new npm package publication, remote CI verification, deployment or
performance measurement is claimed by this implementation note.

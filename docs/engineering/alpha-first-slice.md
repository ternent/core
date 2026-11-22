# Identity, Armour and the Concord first slice

This established migration path is retained for the project brief's implementation
history. The first slice introduced strict Identity capabilities, TypeScript age
composition and a private register lifecycle. Subsequent work added independent
groups, drafts, storage proof and Seal, then moved the signed container and history
lifecycle into standalone Ledger. [ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md)
records that accepted container change; earlier Concord-only signed bytes are not a
compatibility promise.

The current workspace is five libraries. Setup and check scope live in
[CONTRIBUTING.md](../../CONTRIBUTING.md) and the
[repository guide](repository-hygiene.md); release work lives in the
[release backlog](release-and-deployment.md). Earlier migration commands, test totals
and temporary artifact digests do not certify the current checkout. Git retains the
superseded implementation reports and sources.

## Retained capabilities and their owners

| Area                   | Retained behavior                                                                                                                        | Current owner                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Identity               | Seeds, mnemonic/serialized helpers, Ed25519 signatures, X25519/age conversion, strict public identities and exact-byte signer capability | Identity public exports; secret scalar callbacks stay scoped and cleaned up |
| Encryption             | Recipient/identity/passphrase and binary/text age operations                                                                             | Armour over typage, without WASM or an initialization lifecycle             |
| Signed history         | Bounded parsing, canonical subjects, IDs, signatures, chain verification, comparison, staging and ordered replay                         | Ledger's common container and lifecycle                                     |
| Private framework      | Bootstrap, signer-bound authority, group epochs/wraps and contextual application encryption                                              | Concord system extensions using Identity/Armour                             |
| Application projection | Typed commands, event validation and pure reducers                                                                                       | Concord application models; register is an example in `/testing`            |
| Publication            | Complete candidate evaluation followed by atomic adoption; detached bytes/reports/state                                                  | Concord runtime above a private candidate Ledger handle                     |

Identity's contextual convenience signing and capability exact-byte signing remain
distinct contracts. Armour's production implementation does not invoke the native
age executable; the independent executable is a test oracle. Seal owns its separate
proof format and does not depend on Concord for canonical subjects.

## Lifecycle proof

The small register demonstrates:

```text
create -> dispatch/commit -> export -> open -> verify -> replay -> inspect
```

Create signs genesis; immediate dispatch commits an encrypted event. Export contains
committed history. Open with the matching reader verifies all reachable history,
completes system replay and reconstructs the register. A decrypt-only reader can
reconstruct without write authority. Missing requirements, unavailable keys, invalid
integrity and failed application reconstruction have explicit inspection outcomes;
none publishes a partial trusted projection. Replay consumes saved history rather
than reissuing commands with new randomness.

The [protocol](../concord/alpha-protocol.md),
[standard profile](../concord/standard-profile.md),
[conformance cases](../concord/conformance.md) and
[fixed vectors](../concord/vectors/README.md) define the current checks.
Public tests preserve malformed input, tamper, context, authority, reducer failure,
resource limits, concurrent authoring and detached-value cases. Semantic negative
fixtures are re-signed with public test seeds so system/model failures are distinct
from ordinary integrity failures.

## Later slices and explicit boundaries

Independent membership and readable/locked replay are described in the
[group note](independent-groups-2026-11-20.md) and
[group contract](../concord/group-profile-design.md). Draft cases are defined in
[conformance](../concord/conformance.md#d-and-s-grouped-authoring-and-complete-standard-profile-step-4).
Drafts are in memory; consumers own persistence/recovery under
[ADR 0019](../adr/0019-keep-draft-persistence-with-consumers.md).
The [storage contract](../concord/storage-boundary.md) keeps saving separate from
local commits and makes expected-head conflict limits explicit.

The former handshake application is retired. Its useful library contracts survive
in public lifecycle, group, draft, storage and installed-consumer tests; no maintained
MCP application or hosted board is required to release these libraries. UI is outside
scope, Workspace is deferred, and legacy import is separate work. Custom asynchronous
profiles still obey the host no-reentry contract in
[ADR 0014](../adr/0014-keep-async-profile-reentry-a-host-contract.md).

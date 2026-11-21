# Concord project brief

Current scope, 2026-11-21. This brief records the accepted product direction and
repository boundaries. [AGENTS.md](../../AGENTS.md) owns the working agreement;
[CONTEXT.md](../../CONTEXT.md) defines the domain language. In a conversation without
repository access, supply those files with this brief. They are context, not a
separate running agent or background process.

## Purpose and ethos

Concord supports small, user-owned applications whose durable state is a portable
signed document. Keep the history, sign contributions, replay it into application
state, and let consumers decide where it lives. The
[original Ledger](https://github.com/ternent/ledger/tree/76f857338d209f0d512c0ba66ed31ad13f5e6432/packages/ledger)
is a reference for that ethos, not a requirement to preserve every old mechanism
or wire format.

Signed history is authoritative; projections are derived. A document can move
between storage providers and be verified independently. Interpreting its application
meaning additionally requires conforming model/system implementations and any
required keys. The host selects trusted executable code; documents never load code.

The [alpha architecture](alpha-architecture.md),
[current protocol](alpha-protocol.md) and
[standard profile](standard-profile.md) define the accepted framework. The
[repository guide](../engineering/repository-hygiene.md) describes actual package
and acceptance scope. Recheck dated evidence before making readiness claims.

## Five public libraries

| Library  | Responsibility                                                                                          |
| -------- | ------------------------------------------------------------------------------------------------------- |
| Identity | Public identities, private capabilities, signing, recovery helpers and key conversion                   |
| Armour   | age-compatible encryption through typage (`age-encryption`) and explicit payload codecs                 |
| Ledger   | Standalone common signed container, staging, commit construction, verification and ordered replay       |
| Concord  | Commands/previews, authority, independent encrypted groups and application replay composed above Ledger |
| Seal     | Independent proof, artifact and manifest formats, public APIs and Node CLI                              |

[ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md) assigns the container
and history lifecycle to Ledger. Concord uses that same container and delegates
commit construction; it has no competing signed history engine. The previous
Concord alpha format deliberately breaks, with no legacy importer included.

Ledger has no Armour dependency, recipient management or automatic decryption.
Its optional payload helpers compose explicitly with an external codec. Concord
owns framework authority, group protection and decryption before model replay.

## Product decisions to preserve

- Application models define typed commands, validated domain events and pure reducers.
  A document declares one bounded model. Identical history, conforming implementations
  and available capabilities must reconstruct the same projection. Time, randomness
  and external reads belong in authored inputs, not replay.
- Immediate signed commits are the default. Draft mode groups command intents before
  an explicit commit. Ledger staging and Concord intents stay in memory; consumers
  choose commit cadence and own any draft autosave/recovery under
  [ADR 0019](../adr/0019-keep-draft-persistence-with-consumers.md).
- Storage publication is separate from local commits. Ordinary exports contain
  committed history. Storage supplies bytes, not trust. The
  [storage contract](storage-boundary.md) preserves failed local work and surfaces
  head conflicts without silently choosing or combining divergent histories.
- Each snapshot selects one head. Signatures establish integrity and authorship,
  not global consensus, freshness or completeness. A remembered head or another
  external anchor is needed to detect rollback or withheld variants.
- The default `document` group and additional groups have independent memberships
  under [ADR 0015](../adr/0015-keep-audience-memberships-independent.md). Removing
  default membership does not revoke unrelated group access. Group owners do not
  gain automatic access to other groups. Admission/readmission grants that group's
  history; removal rotates its future key without erasing retained keys or plaintext.
- System replay establishes authority and decryptability before application replay.
  Invalid history cannot publish trusted state. Models that require every event stay
  locked when some are unavailable; opted-in readable views expose locked markers,
  coverage and counts. Scoped coverage never certifies hidden application semantics.
- Encrypt application content, group titles and descriptive metadata wherever the
  design permits. Every public envelope field needs a verification, key-discovery or
  interoperability reason. Minimise public membership, grant-recipient identities
  and correlating group references where authority and key discovery permit.
  Current encryption does not conceal all membership, author, linkage, size or
  activity metadata; do not claim otherwise.
- Keep access honest. If a holder can read data from the raw document or decrypt it
  with their keys, an application should provide access to it. UI filtering is not
  confidentiality. Distinguish readable, locked, unverified and trusted information;
  inspection of evidence does not grant authority or a trusted projection.

## Current repository and delivery scope

The active workspace contains exactly the five public libraries above. Portable
Tooling is not a public product. The tooling package/profile fixtures, handshake app,
VitePress patch, copied legacy implementations, Utils and obsolete publishers were
removed under [ADR 0020](../adr/0020-simplify-core-around-five-libraries.md).
Git preserves their history. Ledger remains an active standalone library.

UI is dropped from this release under
[ADR 0017](../adr/0017-drop-ui-from-the-library-release.md). Workspace is deferred:
it is not live, and its existing sources/edits do not block the libraries. Applications
and demos belong outside core and follow stable libraries and their delivery setup.
Do not make Workspace cleanup or an application port a library prerequisite.

Candidate checks install all five exact tarballs through an isolated registry.
Release planning, collision detection, retryable publication and Seal bundle
verification are implemented. Read-only CI exercises the pinned Seal Action with a
disposable test identity. Production workflow wiring, release identity/trust setup
and public-registry acceptance remain on the
[release backlog](../engineering/release-and-deployment.md). No package publication
or deployment follows merely from merging or tagging this branch.

Performance on representative workloads remains an open follow-up. Measure a workload
envelope and consider incremental replay under the
[replay performance follow-up](../engineering/repository-hygiene.md#replay-performance-follow-up).
Incremental replay/checkpoints are not implemented. A second complete implementation
or external protocol/security review remains future assurance work; it is deferred
from the current task, not evidence already obtained.

## Repository map

| Area                                                | Starting point                                                  |
| --------------------------------------------------- | --------------------------------------------------------------- |
| Signed container, verification, staging and commits | `packages/ledger/src/`                                          |
| Framework lifecycle, drafts and atomic publication  | `packages/concord/src/runtime.ts`                               |
| Host/model replay validation                        | `packages/concord/src/runtime/`                                 |
| Authority, groups and key distribution              | `packages/concord/src/system/`                                  |
| Memory storage/conflict reference                   | `packages/concord/src/testing/`                                 |
| Package inventory and setup/checks                  | `pnpm-workspace.yaml`, [CONTRIBUTING.md](../../CONTRIBUTING.md) |
| Candidate checks and release planning/publication   | `scripts/verify/`, `scripts/release/`                           |

Our [toolchain engineer profile](../engineering/developer-archetype.md) guides
engineering practice: explicit checks, useful diagnostics and measured feedback.
Use current reports and retained artifacts as evidence for their own revision;
configured checks and older successful runs do not certify newer edits.

## Application reference and earlier work

The [todo application in samternent/home](https://github.com/samternent/home/blob/main/apps/concord-demo/src/route/workspace/WorkspaceTodo.vue)
supplies useful behavioural requirements: tasks/lists, assignments and independently
shared private groups inside one document. Keep that multi-tenant, entry-level
encryption story; separate documents for each group would change the demonstration.
The reference is not proof that every historical security mechanism is correct.

Earlier migration inventories, test counts and the retired handshake pilot are in
Git history. They do not describe the active workspace or establish compatibility
with the current container. The current package READMEs, normative contracts and
revision-bound acceptance reports are the starting points for implementation work.

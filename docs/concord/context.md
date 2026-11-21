# Concord project brief

Current shipping decision, 2026-11-20: keep the default `document` audience and
independent group memberships; default-group removal has no implicit effect on
other groups. [ADR 0015](../adr/0015-keep-audience-memberships-independent.md) records
Sam's acceptance. The [group design](group-profile-design.md) records the schema/replay contract now
implemented by B03/B04. B05 implements draft batches; B12 now implements the reusable storage/conflict reference proof.

This brief provides project context for Codex and ChatGPT. The working agreement
is in [AGENTS.md](../../AGENTS.md). In a ChatGPT conversation without repository
access, attach or paste both files; local files do not by themselves configure
that conversation. Treat dated observations as evidence to recheck, not current
test results.

Our developer profile is [the toolchain engineer](../engineering/developer-archetype.md):
Oxc-oriented tooling, fast feedback, executable checks, and verification of actual
consumer behavior. Include that profile when sharing this context with another
conversation about engineering practice.

## Purpose

Concord supports small applications whose durable state is a portable signed document
and whose runtime state is reconstructed by deterministic replay. The accepted clean
rebuild direction is documented in [alpha architecture](alpha-architecture.md), with
canonical language in [the root glossary](../../CONTEXT.md). Those documents supersede
the current package specifications when defining the new product.

Product reference: [ternent.dev/concord](https://ternent.dev/concord). The current
[Concord spec](../../packages/concord/SPEC.md) and
[Concord README](../../packages/concord/README.md) describe the active alpha.

## Repository map

| Area                                      | Starting point                    |
| ----------------------------------------- | --------------------------------- |
| Document parsing, signatures and linkage  | `packages/concord/src/protocol/`  |
| Lifecycle, drafts and atomic publication  | `packages/concord/src/runtime.ts` |
| Private host validation and model replay  | `packages/concord/src/runtime/`   |
| Authority, audiences and key distribution | `packages/concord/src/system/`    |
| Memory storage and conflict reference     | `packages/concord/src/testing/`   |
| Package selection                         | `pnpm-workspace.yaml`             |
| Repository acceptance checks              | `scripts/verify/`                 |

The copied legacy archives, retired Ledger and Utils products, and obsolete
publish workflows were removed on 2026-11-21. Git retains their history.
Workspace is intentionally deferred until the libraries are stable and a substantial
set of demos has been built. It is not live and does not block library readiness.
UI is dropped from the v1 release; B08–B10 are cancelled under
[ADR 0017](../adr/0017-drop-ui-from-the-library-release.md). The five release products
are Identity, Armour, Concord, Seal and portable Tooling. Candidate-registry
verification and publishing come next; demo UI choices follow actual demo needs.
The migration evidence below is historical, including references to removed paths.

## Migration context

Sam described this as a half-completed migration from `samternent/home`, with
concerns about implementation quality. Migration completeness and runtime
correctness both need evidence; copying files does not establish either.

The legacy checkout observed on Sam's machine was
`/Users/sam/dev/samternent/home`. Verify its availability and revision when needed.
The matching `@ternent/ledger` package is under `packages/ledger-v2`, while
`packages/ledger` is the older `ternent-ledger` package. The application runtime
is under `apps/solid/src/app/`. Treat the legacy checkout as reference unless a
task includes changes there. It may have diverged from the migration source.

## Evidence from 2026-10-09

Assessment at core revision `8f78367`, including pre-existing uncommitted edits
to `packages/workspace/test/runtime-core.test.ts`:

- Concord and Ledger were excluded from the pnpm workspace. Workspace resolved
  published versions rather than this repo's local Concord and Ledger sources.
- Local Ledger referenced absent workspace packages `@ternent/concord-protocol`
  and `@ternent/seal-cli`. Concord also referenced absent development dependency
  `@ternent/rage`. Enabling workspace entries alone would not finish the migration.
- `pnpm --filter @ternent/workspace build` passed, producing `index.es.js` and
  `index.umd.js`. The package manifest expected `dist/index.js`; importing the
  package from its own directory failed. Public API tests imported source directly.
- `pnpm --filter @ternent/workspace test` reported 14 passes and one failure.
  The failing test recreated a permission with fresh keys and timestamps and
  compared the resulting projections. It did not establish a replay determinism
  defect because the underlying inputs differed.
- Workspace's publishing workflow built without running tests.

On 2026-10-20, the revision, workspace exclusions, dependency declarations, and
Workspace build configuration were rechecked. The build and tests were not rerun.
No migration repairs have been made as part of the agent setup.

## Current implementation and next engineering task

The tooling pilot, Identity/Armour migration and private Concord first slice are now
implemented. See [the migration report](../engineering/alpha-first-slice.md) for current
scope, reused implementation, supported consumers and executed acceptance checks.
Existing helper behavior is preserved where it matches the accepted contracts; this
is an architectural migration rather than a reason to replace proven primitives.

Standard member events and the [local handshake pilot](../../apps/handshake/README.md)
are implemented. The handshake exercises private immediate commits with two writers and
an invited reader. The reusable expected-head storage proof is implemented in the testing subpath;
[its contract](storage-boundary.md) limits atomicity to a shared reference instance. The product priority below supersedes the earlier choice of
hosted receipt exchange as the next milestone; the handshake remains implementation
and acceptance evidence.

## Library-first production goal — 2026-11-18

Sam confirmed that the immediate public offering is the individual Ternent libraries.
Developers and their agents should be able to compose applications from those parts
to keep durable data portable, signed, independently verifiable, and under user control.
Workspace is Sam's own composition and is outside the current public-product scope.
Concord already owns its document guarantees through the runtime and selected system
profile; those guarantees are not deferred to Workspace.

The immediate goal is to solidify the libraries in `ternent/core` for production use.
Sam explicitly corrected the proposed app-first sequence: do not build or port new
applications until the core libraries meet their agreed production-readiness gates.
Existing applications supply requirements and behavioural evidence; they are not the
next implementation deliverable. The reference application is the existing
[todo application in samternent/home](https://github.com/samternent/home/blob/main/apps/concord-demo/src/route/workspace/WorkspaceTodo.vue),
not a new invented example. Complete the library migration and package CI/CD first.
Mini applications, a todo port and demo deployments follow that foundation. Workspace
remains outside this scope. Sam reaffirmed on 2026-11-21 that Workspace can wait until
the libraries run smoothly and plenty of demos exist; do not schedule its cleanup or
migration as a prerequisite for either.

Start with a source-to-target inventory of the libraries and a package-by-package gap
assessment. Map existing contracts to target owners; the old package layout does not
override the accepted boundaries. Establish explicit release gates for public APIs and
versioned formats, required behaviour and security failure paths, local dependency
wiring, built imports and declarations, supported Node/browser consumers, documentation,
and verified package publication. Use tests, conformance vectors and consumer fixtures
to establish readiness without requiring a new application. Passing a build or a source
test suite alone does not establish production readiness. Record verified outcomes and
remaining gaps separately; do not describe the current alpha as production-ready.

Source inspection on this date found that the reference UI supports tasks, lists,
assignments, and public/private list groups. Its
[useLedger integration](https://github.com/samternent/home/blob/main/apps/concord-demo/src/module/ledger/useLedger.ts)
uses `ternent-ledger`, `ternent-ledger-vue`, legacy identity/encryption utilities,
IndexedDB, and application-managed permission keys. Retain useful application behaviour
while moving document security and replay responsibilities to their current owners.
These are source findings, not a fresh execution of the reference application.

Sam clarified that this is a collaborative, multi-tenant document example. Entry-level
encryption for distinct permission groups, with encrypted group-key grants embedded in
the same Concord JSON, is a central product capability. Readers can hold the same
document while decrypting different groups' entries. Moving each independently shared
list into a separate document would change that demonstration and is not the chosen
substitute for it. The application remains a reference for behaviour, not evidence that
every legacy security mechanism is correct.

The alpha now implements independent groups and explicit readable/locked replay.
The pre-release profile revision, per-group authority/epochs and command routing are
specified in [the standard profile](standard-profile.md). Full signed history remains
verified; models opt into locked markers rather than silently omitting hidden events.
Successful scoped projections carry readable coverage and never certify hidden
application semantics. The [implementation note](../engineering/independent-groups-2026-11-20.md)
records executed checks and limits.

Sam's metadata preference is to encrypt whatever can be encrypted. Treat application
content, group titles and descriptive metadata as private by default. Minimize exposure
of group membership, grant-recipient identities and correlating group references where
the chosen key-distribution and authority design permits it. Each cleartext field needs
a concrete verification, key-discovery or interoperability reason; do not inherit the
legacy example's public group records as a product requirement.

This is a privacy direction, not an implemented metadata-hiding guarantee. Specify the
remaining public envelope and its observable relationships explicitly. Encryption does
not by itself conceal document size, record count, ciphertext size, or the authors and
linkage exposed by the current protocol. Moving authority records behind encryption also
changes who can validate those semantics: public integrity verification must remain
distinct from authority validation requiring the relevant keys. Resolve these details
before claiming that unrelated group membership or activity is hidden.

Sam requires honest UI access: if a user can read information from the raw document,
including by decrypting it with keys they possess, provide UI access to that information.
Do not artificially hide accessible data or present UI filtering as a confidentiality
boundary. Public metadata and ciphertext remain inspectable; decryptable content is
available through appropriate views. Distinguish readable, locked, unverified and
verified information explicitly. Inspection of readable but untrusted evidence must
not imply a trusted application projection or permission to author. Removing membership
does not justify claiming that historical data or keys already obtained are gone.

The active workspace includes Identity, Armour, Concord, Seal, portable Tooling,
the handshake and tooling-profile fixtures. UI is outside the v1 product scope;
Workspace is deferred, and Ledger/Utils have been retired. One `ci.yml` verifies
candidates; the old publishers have been removed. The
[delivery contract](../engineering/release-and-deployment.md) describes the remaining
verified-artifact publisher, not an installed or authorized npm publication path.

## Using this setup

Codex uses repository `AGENTS.md` guidance when starting work in this project;
see the [official instructions guide](https://learn.chatgpt.com/docs/agent-configuration/agents-md).
This brief is supporting context, not a separate running agent or background job.
For another conversation, supply this brief and the working agreement with the
specific outcome you want. Do not assume it shares this conversation's history
or can access local files until that access is established.

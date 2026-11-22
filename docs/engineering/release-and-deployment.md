# Library release contract and backlog

Current scope, 2026-11-21: ship five independently usable npm products:
`@ternent/identity`, `@ternent/armour`, `@ternent/ledger`, `@ternent/concord` and
`@ternent/seal`. Ledger owns the common signed container; Concord composes the
framework above it. [ADR 0020](../adr/0020-simplify-core-around-five-libraries.md)
records the repository simplification. UI, portable tooling and hosted applications
are outside this release. Workspace is deferred.

The candidate planner, retryable publisher and production workflow chain are
implemented. Account onboarding and the first registry-backed acceptance remain.
Publication is disabled until explicitly configured. The verification scope is
described in the [repository guide](repository-hygiene.md); candidate checks alone
do not establish public-registry consumption.

## Current boundary

The five libraries implement identity/encryption primitives, Ledger's signed-log
lifecycle and optional Armour payload codecs, Concord's independent groups/readable
replay/drafts/storage boundary, and Seal's library/CLI. Staging is deliberately in
memory; consumers own commit cadence and any draft persistence/recovery under
[ADR 0019](../adr/0019-keep-draft-persistence-with-consumers.md). There is no pending
library persistence feature or UI migration required for release.

Current candidate acceptance serves exact packed tarballs from a disposable loopback
registry and installs by package name/version in an external directory, without
sibling overrides. The registry cannot proxy `@ternent/*` to published predecessors.
It checks candidate integrity, strict publint, runtime behavior, declarations,
CLI, fixed vectors, import isolation and Chromium. Deliberate missing-candidate and
incompatible sibling-range probes must fail. This establishes candidate dependency
resolution, not publication or consumption from the public registry.
The publisher consumes a retained plan and tarballs, checks collisions, and journals
partial publication and channel promotion. Its live entry point requires the
`release.yml` workflow on main, explicit enablement, a trusted Seal key and pinned
npm 12.2.3. No repository variables, secrets, environments or npm trust were
configured during implementation. Merging this foundation cannot publish until
the enablement variables and account setup below exist.

## Release backlog

The identifiers below retain the useful remaining shipping work without carrying
forward completed migration slices or cancelled UI/tooling products.

| Item                        | Deliverable                                                                                                                    | Observable exit                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B13 — Candidate registry    | Implemented: serve all five final-name/version tarballs from an isolated temporary registry; install without sibling overrides | Candidate digests and resolution failure probes are checked by the consumer gate; each run's reports record the Node/browser/type/CLI/vector/isolation results                    |
| B14 — Planner and publisher | Implemented: Changesets version intent, immutable release bundle and dependency-ordered retryable publisher                    | Release tests cover failure/retry and exact npm argv; CI exercises the pinned Seal Action and verifies the complete candidate bundle                                              |
| B15 — Workflow chain        | Implemented: separate version-PR and protected signing/publishing workflows, immutable artifact handoff and retry restoration  | Tests cover provenance rejection, production signing, unchanged candidate bytes and resume; checksum-pinned actionlint validates workflows; account enablement remains below      |
| B16 — Registry acceptance   | Verify existing versions/tags and trusted publisher settings; authorized test-channel proof and fresh published consumption    | Registry integrity matches retained tarballs; exact published versions work outside this checkout without overrides; receipts record incomplete as well as complete channel state |

B13's consumer gate feeds B14's final artifact proof; B15 wires that proof into
automation; B16 needs real account inputs and explicit release authorization. Implementations must inspect
current npm/GitHub policy and supported tool versions rather than treating older
external service details as permanent. No account setting has been established by
this document. The separate Seal Action's package/version configuration and any
registry-backed run belong to published-consumption acceptance.

## Immutable candidates and release plan

`pnpm release:version` runs Changesets after checking proposed alpha versions against
observed npm history. It updates the lockfile and writes `release-intent.json` with
the five-library version snapshot. The pending foundation changeset records this
branch's library changes. The first version run checks current alpha baselines
against npm before entering Changesets alpha mode; proposed versions are checked
again before manifests change. Allocation and a subsequent frozen reinstall have
been exercised in a disposable clone, without changing this checkout's versions.

After `pnpm check`, `pnpm release:plan` freezes the retained candidates and reports
under `artifacts/release/`. The source must be committed and reports must bind that
revision. A changed public version requires matching release intent. An unchanged
revision without intent produces an explicit no-op plan while retaining all five
candidates for proof verification. CI uses `verification-plan` to retain such a
no-op bundle before version allocation; that mode cannot infer publication intent
from changed versions. The strict production planner rejects that missing intent.

CI invokes `samternent/seal-action` at
`d07a683a9195a1190c3e15b6e4374a1d59592b57`, using an explicit built CLI from the
checked revision. It signs `release-manifest.json` covering the final plan, reports
and unchanged tarballs plus captured verifier tools, and emits `release-proof.json`
and `release-public-key.json`.
The verification job uses a disposable test identity. These are CI test proofs;
production release eligibility requires a separately configured release public key.
Sign a clean bundle: remove the three disposable proof outputs before production
signing, preserving and rechecking the plan, reports and tarball bytes.
The Action's old npm package defaults are not used, and this does not imply a
registry-backed run of the new Seal package.

The publisher requires Seal verification before reading or mutating npm state.
Verification binds the signer to the externally trusted key, checks the proof and
every file hash, rejects symbolic links and requires an exact manifest file set.
A bundled public key cannot establish its own trust. Keep receipts outside the
signed bundle so retries cannot silently alter the accepted artifacts.

`pnpm release:publish` uses only retained tarball paths. After publication under a
release-specific candidate tag, it reuses the full consumer harness in fresh public
registry mode, without packing or sibling overrides. Only then may it promote `next`.
Public-registry execution remains unverified until the authorized B16 exercise.

Use Changesets for independent package version intent and sibling range changes.
Do not select versions from commit messages or reset existing npm names to a fresh
version sequence. Check actual registry state before allocating releases. Alpha
versions use the `next` channel; stable `latest` promotion is an explicit policy.
The prerelease version and registry dist-tag are separate concepts.

A planner discovers eligible public manifests, validates the committed version plan
and dependency graph, then records at least:

- Source SHA, lockfile SHA-256, exact toolchain versions and target channel.
- Each package's name/version, safe relative tarball path, SHA-256 and sha512 SRI.
- Exact in-release sibling versions and dependency publication order.
- Gate-report digests, artifact retention/expiry and a deterministic release ID.

Finalize the plan only after candidate and gate digests exist. Use RFC 8785
serialization for the plan and its SHA-256 release ID. This is automation metadata,
not a reason to import Concord runtime cryptography. No credentials belong in the plan or report.

The release flow must preserve the checked bytes:

1. Check out the eligible version commit; use frozen setup and validate public
   metadata, scripts, workspace ranges, exports and release intent. Run all required
   source, type, behavior, build and consumer gates for that revision.
2. Build in dependency order and pack each public candidate once with pnpm's normal
   workspace-range rewriting. Reject lifecycle hooks that rebuild or rewrite during
   packing/publication. Compute digests and retain those exact tarballs.
3. Run strict publint and isolated-registry consumers against final names/versions.
   External dependencies may resolve normally; in-release siblings must resolve only
   to candidate bytes, with missing candidates/ranges failing. Retain reports and
   prove tarball digests remain unchanged.
4. Upload the finalized plan, reports and candidates under source SHA/release ID.
   The publisher accepts only artifacts from the eligible same-SHA run and verifies
   provenance and every digest. A pull-request artifact cannot authorize main release.
5. Query npm before publishing each dependency-ordered package. Absent versions may
   receive the exact retained tarball; identical existing integrity is already done;
   different integrity is `VERSION_COLLISION` and blocks dependent publication.
6. Use a per-release candidate tag, bounded registry propagation retries and a fresh
   registry consumer check. Move intended `next`/`latest` tags only after the whole
   set passes. Record prior/target tags, each result and final release receipts.

Invoke publication with validated argv and the retained tarball path, never shell
interpolation of manifest text or a recursive publish command that repacks. A new
version without a valid plan fails; a validated run with no new public version is
an explicit no-op. Tags document successful publication rather than triggering a
second publisher.

## Failure and retry contract

An npm release set is not atomic. Journal each package's expected/observed integrity,
source SHA, release ID, attempt and state. A partial outage resumes the same artifacts,
skips identical completed versions and continues in dependency order. Never invent a
version or rebuild under an old digest to bypass a failed publish. If retained bytes
expire, create a new verified run/plan and compare any existing registry integrity.

Dist-tag promotion is also non-atomic. Record partial promotion and restore prior
values where permitted, reporting any remaining state. Alpha publication must not
change `latest`. npm unpublish is not a rollback mechanism. Do not mark a release
complete until all required packages and published consumers pass.

Use structured diagnostics with phase, source SHA, release ID, package, retryability
and a useful exit status. Meaningful failures include missing/tampered artifacts,
invalid plans, collisions, unavailable registry, unconfigured package identity and
partial publication. Keep secrets out of diagnostics. Tests use saved responses and
argv-recording adapters before authorized live test-channel exercises.

## Workflow and account boundary

There is one publisher, `release.yml`. Read-only `ci.yml` verifies every PR and
main push; `version.yml` uses a repository-scoped GitHub App to open a draft version
PR for unconsumed changesets. The App token lets that PR receive ordinary CI events.

A successful main push verification triggers release selection. The selector checks
repository, event, branch, workflow identity, completion, main ancestry and a newly
changed five-library intent. Missing or unchanged intent is an explicit no-op.
PR evidence, failed runs and arbitrary dispatch refs are rejected. Manual dispatch
requires both the successful main-push verification run ID and its exact release ID.
An explicit dispatch may select an unchanged committed intent after a publisher-only
fix. It uses that new run's verified plan and retained tarballs, with the same source,
digest, collision and channel checks. Automatic runs still skip unchanged intent.
This permits infrastructure recovery without inventing new library versions.

Selection binds one `core-evidence` artifact ID and GitHub SHA-256 archive digest.
The publisher checks that digest before extraction or execution, rejects unsafe ZIP
paths and excessive sizes, restores the captured built tools and checks the plan,
committed intent, lockfile, reports and tarball bytes against the producer SHA.
It does not rebuild or repack. The original disposable proof is checked before its
three sidecars are replaced; the production manifest additionally binds
`release-origin.json`. The pinned Seal Action signs with the dedicated release
identity, and verification uses the separately configured trusted public key.

The release workflow's default SHA can be newer than the producer SHA. Checkout,
plan validation, published-consumer reports and npm provenance therefore use the
validated producer SHA. In particular, the npm child receives that SHA as
`GITHUB_SHA`; the workflow/invocation identity remains the actual release workflow.
No caller can supply an arbitrary SHA or registry.

Publication runs on a GitHub-hosted Ubuntu runner in the `npm-release` environment,
with read-only contents/actions permissions plus `id-token: write`. npm 12.2.3 is
pinned for OIDC publication **and dist-tag management**. There is no npm token
fallback. The release identity secret is available only to its materialisation
step, checked against the expected public key, written outside artifacts with mode
0600 and removed after signing. Versioning has no npm or Seal identity.

### One-time account setup

Land the reviewed workflows on main before enabling them. Configure these exact
values; private material belongs in GitHub secrets, never repository files or chat.

| Location               | Name                           | Value or scope                                                                         |
| ---------------------- | ------------------------------ | -------------------------------------------------------------------------------------- |
| Repository variable    | `CORE_VERSION_APP_CLIENT_ID`   | Client ID of a GitHub App installed only on `ternent/core`                             |
| Repository secret      | `CORE_VERSION_APP_PRIVATE_KEY` | That App's private key; contents and pull requests write, metadata read                |
| Repository variable    | `CORE_VERSIONING_ENABLED`      | `true` after App setup; enables draft version PRs                                      |
| Repository environment | `npm-release`                  | Restrict deployment branches to main; any required reviewers are an owner policy       |
| Environment variable   | `SEAL_RELEASE_PUBLIC_KEY`      | Raw public-key string from the dedicated release identity                              |
| Environment secret     | `SEAL_RELEASE_IDENTITY_B64`    | Base64 of the complete serialized release identity JSON, without line breaks           |
| Repository variable    | `CORE_RELEASE_ENABLED`         | `true` only after all package trusted publishers and the signing environment are ready |

Create and securely back up a dedicated Seal release identity with the reviewed
CLI. Derive its public-key artifact, configure the raw `publicKey` string separately,
and upload the base64 identity through the secret UI or `gh secret set` from a local
file. A release rejects a mismatched identity before signing. Do not reuse CI's
disposable identity or include private material in evidence.

For **each** existing public package, configure npm trusted publishing:

| npm field         | Exact value                                                  |
| ----------------- | ------------------------------------------------------------ |
| Provider          | GitHub Actions                                               |
| Organisation/user | `ternent`                                                    |
| Repository        | `core`                                                       |
| Workflow filename | `release.yml`                                                |
| Environment       | `npm-release`                                                |
| Permissions       | Enable direct publication and dist-tag management separately |

All five names already exist on npm, so no new-package token bootstrap is needed.
An authenticated package owner must configure their trusted publishers. The
implementation session found no repository release variables, secrets or
environments and no authenticated npm session; it changed none of them.
See [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/).
The first actual publication to `next`, registry integrity comparison, provenance
inspection and fresh published consumption are B16 acceptance; they have not run.

### Retry and retention

The release concurrency group does not cancel a running publisher. GitHub does
not guarantee FIFO for pending runs; inspect skipped/cancelled pending runs and
dispatch the intended eligible release explicitly when needed. Collision and
channel-downgrade checks still apply.

After staging, success or failure retains `core-release-<releaseId>-attempt-<N>`
for seven days. It contains the unchanged signed bundle and an outside publication
receipt when publishing started. Re-running the same workflow run automatically
restores its latest matching journal. For a separate manual retry, supply the same
verification run/release ID plus the prior release workflow's `resume_run_id`.
The handoff checks both workflows and artifacts, binds the prior journal to the
same release, verifies the production signature and never re-signs an already
published attempt.

Artifact upload is best effort after a failure; abrupt runner loss can prevent a
receipt being retained. Do not claim atomic recovery or reconstruct prior channel
values from guesses. Inspect npm state and retained receipts before selecting a
recovery path. Expired or untrusted artifacts cannot authorize a retry.

Once enabled, normal main events provide routine release authorization. Draft
version PRs and the initial enablement remain deliberate owner actions. Neither
merging an unrelated change nor pushing a tag creates new release intent.

## Applications and deployment

Applications/demos live outside core and have independent delivery graphs. The
historical [Cloudflare decision](../adr/0012-deploy-private-ui-apps-to-cloudflare-workers.md)
does not require a board, docs site, deployer or hosting account for the library
release. No core deployment workflow is active.

When an application is implemented, keep its deployment identity separate from npm:
source SHA, exact bundle digest, environment and provider deployment/version receipt.
Deploy the verified artifact without rebuilding. Record resolved library versions and
digests without implying candidate versions are already published. Separate package
failure/retry from application deployment failure/rollback.

Future static-app automation must verify assets, content types, missing-asset behavior,
routing and browser startup; retain the previous compatible artifact and smoke-tested
rollback result. Separate preview and production credentials; fork PRs receive checks
without secrets. Credential-bearing upload/cleanup jobs use trusted automation and
verified artifacts, never execute untrusted PR source. Isolate previews and synthetic
data, and keep host identity seeds out of bundles and environment variables. Provider
account/domain configuration and a real preview/deploy/rollback proof belong to that
application's implementation, not an implied library-release prerequisite.

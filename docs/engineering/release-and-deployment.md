# Library release contract and backlog

Current scope, 2026-11-21: ship five independently usable npm products:
`@ternent/identity`, `@ternent/armour`, `@ternent/ledger`, `@ternent/concord` and
`@ternent/seal`. Ledger owns the common signed container; Concord composes the
framework above it. [ADR 0020](../adr/0020-simplify-core-around-five-libraries.md)
records the repository simplification. UI, portable tooling and hosted applications
are outside this release. Workspace is deferred.

This is a target release contract and ordered backlog, not installed publication
automation or authorization to publish. The current read-only CI and local acceptance
scope are described in the [repository guide](repository-hygiene.md). Builds and
candidate checks do not establish registry publication or account configuration.

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
No verified-artifact publisher is installed. Legacy tag/package publishers have been
retired; merging or tagging the repository does not publish this candidate set.

## Release backlog

The identifiers below retain the useful remaining shipping work without carrying
forward completed migration slices or cancelled UI/tooling products.

| Item                        | Deliverable                                                                                                                    | Observable exit                                                                                                                                                                   |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B13 — Candidate registry    | Implemented: serve all five final-name/version tarballs from an isolated temporary registry; install without sibling overrides | Candidate digests and resolution failure probes are checked by the consumer gate; each run's reports record the Node/browser/type/CLI/vector/isolation results                    |
| B14 — Planner and publisher | Changesets version intent, immutable digest-bound release plan, retained artifacts, dependency-ordered retryable publication   | Saved-response/argv tests cover no-op, missing/invalid plan, private exclusion, tampering, identical retry, collision, partial publication and interrupted channel promotion      |
| B15 — Workflow chain        | One version-PR path and one least-privilege publisher; same-SHA eligible artifact handoff and setup instructions               | Dry runs prove trigger/plan selection, private exclusions and retry behavior; no competing publisher remains; workflow identity and onboarding requirements are documented        |
| B16 — Registry acceptance   | Verify existing versions/tags and trusted publisher settings; authorized test-channel proof and fresh published consumption    | Registry integrity matches retained tarballs; exact published versions work outside this checkout without overrides; receipts record incomplete as well as complete channel state |

B13's consumer gate feeds B14's final artifact proof; B15 wires that proof into
automation; B16 needs real account inputs and explicit release authorization. Implementations must inspect
current npm/GitHub policy and supported tool versions rather than treating older
external service details as permanent. No account setting has been established by
this document. The separate Seal Action's package/version configuration and any
registry-backed run belong to published-consumption acceptance.

## Immutable candidates and release plan

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

Keep source verification read-only. A version-PR workflow has only the write access
needed to update its PR; a publisher has the npm identity permissions it needs, scoped
to its exact repository, workflow and environment. Pin actions to reviewed immutable
SHAs, pin tools, enforce frozen installs and serialize publication without cancelling
an in-flight release. Dispatch selects a validated source SHA/release ID, not arbitrary
commands, registries, paths or package overrides.

Configure npm trusted publishing/OIDC against the actual workflow identity. Recheck
current provider policy and supported versions at implementation time. Exercise a
dedicated test package/channel before production releases. Package/scope bootstrap
and trust provisioning are explicit onboarding steps; do not silently fall back to
a broad stored token. If version PRs need a GitHub App to receive normal CI events,
document and provision it separately. No credential values belong in repository files.

Once Sam deliberately enables a release policy, its normal repository events can
provide routine authorization. This design neither enables a workflow nor adds an
approval to every future run. Retain receipts identifying versions, digests, workflow
run and registry observations; do not infer published consumption from a local build.

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

# Repository guide

Current structure, 2026-11-21. [ADR 0020](../adr/0020-simplify-core-around-five-libraries.md)
records the simplification; [CONTRIBUTING.md](../../CONTRIBUTING.md) owns setup and
commands. This guide describes configured scope, not the outcome of an uncompleted
check or a published release.

## Ownership

The active workspace contains exactly five public ESM libraries:

| Library  | Owns                                                                                                         |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| Identity | Identity validation, seed custody, signatures, recovery and key conversion                                   |
| Armour   | age encryption/decryption and explicit payload codecs                                                        |
| Ledger   | Common signed container, canonical bytes, IDs, signatures, staging, commits, verification and ordered replay |
| Concord  | Command intents/previews, system authority and decryption, model replay and atomic publication above Ledger  |
| Seal     | Its independent proof/artifact/manifest formats and separate Node CLI                                        |

Ledger and Concord stage work in memory. Consumers own commit cadence, draft
persistence and recovery; there is no missing library persistence layer to ship.
[ADR 0019](../adr/0019-keep-draft-persistence-with-consumers.md) records that boundary.
Storage publication remains external under the
[storage contract](../concord/storage-boundary.md).

`packages/` holds the products, `scripts/verify/` holds small repository checks,
and `docs/` holds contracts, vectors and decisions. `pnpm-workspace.yaml` is the
package inventory. Root formatting, lint and test discovery derive their package
scope from it; standard pnpm recursion builds dependencies before consumers.

The portable tooling package, profile fixtures, handshake app and VitePress patch
are removed. Ordinary `vite.config.base.ts` and `tsconfig.base.json` share defaults;
explicit package configs own entry/output mappings and the Seal CLI environment.
Do not rebuild a general profile framework inside repository scripts.

UI is outside the library release under [ADR 0017](../adr/0017-drop-ui-from-the-library-release.md).
Workspace is deferred until the libraries are stable and substantial demos exist.
Their excluded sources and existing edits remain outside active acceptance.
Applications and demos should consume published libraries from separate projects.

## Toolchain and installation

| Tool         | Repository pin                      | Use                                                               |
| ------------ | ----------------------------------- | ----------------------------------------------------------------- |
| Node         | 26.13.1                             | Development and CI                                                |
| pnpm         | 12.21.0                             | Frozen dependency installation and recursive builds               |
| Vite+        | 1.7.0                               | Library build, Oxfmt, typed Oxlint and behavior tests             |
| TypeScript   | `npm:@typescript/typescript6@6.0.2` | Explicit `tsc6` checks and declaration/compiler API compatibility |
| publint      | 0.3.25                              | Standard built-package and exact-tarball validation               |
| Vue          | 3.5.46                              | Runtime in the temporary browser consumer                         |
| Playwright   | 1.65.1                              | Chromium execution against installed candidates                   |
| Verdaccio    | 7.1.2                               | Disposable local candidate registry with no uplinks               |
| Changesets   | 3.0.3                               | Package version intent and changelogs                             |
| canonicalize | 5.1.0                               | RFC 8785 release-plan serialization                               |
| semver       | 7.8.6                               | Candidate dependency and registry version checks                  |
| fflate       | 0.8.3                               | Digest-checked release artifact extraction                        |
| actionlint   | 1.7.12                              | Checksum-pinned GitHub workflow validation                        |

Volar, vue-tsc, unplugin-vue and the Vue Vite plugin are no longer direct repository
dependencies or explicit requirements. Declaration tooling may still resolve Vue
typing peers transitively.
The browser proof uses `createApp`, `h`, a button and CSS; no SFC or docs build is a
release requirement. Product dependencies remain with the package that uses them.
Armour uses typage (`age-encryption`); native age is an independent test oracle.

pnpm reads install policy from `pnpm-workspace.yaml`; `.npmrc` declares the registry.
The workspace explicitly permits esbuild's install script and records the reviewed
Vue release-age exceptions. The lockfile resolves transitive versions. Toolchain
updates need the same source and installed-consumer checks as other packaging changes.
No speed claim follows from switching tools without a measured comparison.

## Acceptance boundaries

`pnpm check` runs nine separate gates: project contract, read-only formatting,
recursive build, typed lint, root types, package types, library behavior, release
automation tests and packed consumers.
The small contract check enforces five-library membership, public ESM metadata,
required scripts and workspace dependency policy. Standard publint validates package
artifacts; it does not replace behavior, declaration or browser checks.

The consumer harness packs each library once, records SHA-256, runs strict publint
on those bytes, and installs the candidates by name/version outside the workspace
from a disposable loopback registry, without sibling overrides. It exercises Node
22.18, Node 24.21 and the development runtime; CI requires the compatibility
executables explicitly. It retains fixed crypto
vectors, public declarations and intended compiler failures, CLI behavior, protocol
and library import isolation, Armour codecs, Ledger lifecycle, Concord groups/drafts/
storage and Seal proof/artifact behavior. A temporary plain Vite+ Vue production
build executes those browser proofs in Chromium and checks CSS/interaction.
Deliberately failing lint, format and behavior inputs check useful failure propagation.

The candidate registry cannot proxy `@ternent/*` to published predecessors. Missing
candidates and incompatible transitive sibling ranges must fail resolution, and
installed candidate integrity is checked against the retained tarballs. Real public
registry publication and fresh published consumption remain on the
[release backlog](release-and-deployment.md#release-backlog).
Reports are `artifacts/check.json`, `artifacts/consumers.json`,
`artifacts/browser.png`, registry logs and retained candidate tarballs. They describe their own run;
older test counts, builds or remote CI results do not certify newer edits.

Reports record their source revision. `scripts/release/` freezes the accepted
candidates into a digest-bound plan, verifies the Seal-signed file set, and provides
a retryable publisher. CI exercises the pinned Seal Action over the candidate bundle
with a disposable identity, retaining `artifacts/release/`. That proof establishes
test integration; production release trust uses a separately configured public key.

## Replay performance follow-up

Incremental replay is a candidate optimisation, not an implemented API or a change
to the trust model. The original Ledger offered `replay(from, to)`; current Ledger
offers `replay({ includeStaged })` and current Concord offers `replay()`. A cursor
alone does not reconstruct the state preceding it.

A locally trusted cache could retain the projection at a verified committed head
and apply only a validated descendant suffix. It must bind the document, head,
model/system implementations, reader/key availability and replay coverage. Concord
also needs the authority, membership and epoch/key state required to interpret the
suffix; a projection and entry index alone are insufficient. Draft previews never
serve as verified committed checkpoints.

Important invalidation cases:

- A branch change requires a compatible ancestor checkpoint or full replay; an
  entry count or timestamp cannot identify the same verified prefix.
- Newly acquired historical keys can make previously locked entries readable.
  Admission/readmission already has this behaviour. Rebuild the affected application
  projection from a suitable earlier checkpoint or genesis rather than applying only
  newly appended events. A changed reader/model/system also invalidates incompatible
  cached state.
- A cache restored from untrusted storage is not trustworthy merely because it names
  a valid head, carries a checksum or has a signature. Establish its provenance and
  correctness under an explicit checkpoint policy or reconstruct from verified
  history. Keep secret system/key state outside portable public snapshots.
- An incoming snapshot must agree with the trusted prefix. Reuse the verified prefix
  itself or establish that agreement; never skip altered historical bytes based only
  on the supplied head identifier. Validate new linkage/signatures and historical
  authority before publishing any extended projection.

Incremental application reduction alone does not remove repeated full-history
verification, decryption, serialisation and copying. Measure those costs separately
on representative document sizes/commit patterns before choosing an implementation.
Full replay remains the correctness reference. Any optimisation must match it for
unchanged capabilities, and explicitly invalidate/rebuild when earlier readability
changes. No performance budget or persisted checkpoint format is established here.

## Automation and retained documentation

Read-only CI installs the frozen lockfile, pinned age reference and browser,
validates workflows with checksum-pinned actionlint, runs acceptance and retains
reports, tarballs and built release verifier tools. Third-party actions are pinned
to reviewed SHAs. Separate version-PR and protected signing/publishing workflows
are implemented behind explicit enablement variables. Account onboarding and real
registry acceptance remain; there is no enabled npm publisher or application deployer.
See the [release contract](release-and-deployment.md) for exact identities, setup and
retry behavior. Acceptance uses synthetic identities, saved registry responses and
recorded publication argv; it does not mutate the public registry.
Renovate is configured without automatic merging; the owner must enable it.

Copied legacy implementations, the retired Utils product and obsolete publishers
were removed; Git retains their history. Current protocol, standard-profile, group,
storage and Seal format docs and fixed vectors remain authoritative. Dated migration,
tooling and review reports whose useful contracts are now represented there are
retired rather than retained as competing plans. The first-slice and independent-group
notes remain at their established paths with current ownership and evidence pointers.

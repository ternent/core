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

## Automation and retained documentation

One read-only CI workflow installs the frozen lockfile, pinned age reference and
browser, runs acceptance and retains reports/tarballs. Third-party actions are pinned
to reviewed SHAs. There is no active npm publisher or application deployer.
The version-PR workflow, protected signing/publishing workflow and registry onboarding
remain on the release backlog. Publisher tests use saved registry responses and
recorded argv; no public registry mutation is part of acceptance.
Renovate is configured without automatic merging; the owner must enable it.

Copied legacy implementations, the retired Utils product and obsolete publishers
were removed; Git retains their history. Current protocol, standard-profile, group,
storage and Seal format docs and fixed vectors remain authoritative. Dated migration,
tooling and review reports whose useful contracts are now represented there are
retired rather than retained as competing plans. The first-slice and independent-group
notes remain at their established paths with current ownership and evidence pointers.

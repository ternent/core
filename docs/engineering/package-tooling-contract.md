# Package architecture and tooling contract

Scope amendment, 2026-11-21: [ADR 0017](../adr/0017-drop-ui-from-the-library-release.md)
removes `@ternent/ui` from the release. Five products ship: Identity, Armour,
Concord, Seal and Tooling. Any UI-product migration/release requirements below are
superseded. Portable Vue profiles, browser fixtures and later demo UI remain useful.

Status: contract retained, concrete repository/tooling/release target selected 2026-10-21.
The [repository architecture](repository-architecture.md) chooses Vite+ profiles and
the clean replacement layout; [release and deployment](release-and-deployment.md)
specifies npm/GitHub/Cloudflare delivery. Those documents refine this contract and
supersede its earlier open tool-selection and UI-placement questions. The
[R1 tooling pilot](tooling-pilot.md) records the implemented workspace and check scope;
the remaining product and release migrations follow that pilot.

The accepted target is [Concord's alpha architecture](../concord/alpha-architecture.md).
Where this older assessment proposes preserving Ledger or Workspace as public packages,
the alpha architecture supersedes it.

## Product direction

Sam wants to focus on Concord and its runtime or a better developer interface.
Encryption should remain usable independently. Sam reports that Seal also has
a standalone GitHub Action; that Action's repository and consumer requirements
have not been inspected in this review.

Accepted direction: Concord is the primary application-facing product, supported by
independently consumable Identity, Armour, and Seal primitives. Protocol helpers live at
a Concord subpath. Ledger mechanics and the former Workspace runtime are internal unless
a concrete independent consumer later justifies a public package.

## Three separate decisions

1. Repository: which code is changed and verified together?
2. Package interface: what can an external consumer install and use independently?
3. Release policy: what gets versioned and published together?

A monorepo can contain independently released packages. A separate repository
does not establish a good package interface or reliable consumer artifact.

| Option                                      | Benefit                                                               | Cost                                                                                 | Assessment                                                            |
| ------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| One repo, independently consumable packages | Atomic changes across the Concord stack; one verification environment | Requires enforced package interfaces and explicit release dependencies               | Recommended starting point                                            |
| Separate repo per package                   | Independent access, ownership, and release administration             | Cross-repo compatibility work and coordinated changes during an unfinished migration | Revisit when independent ownership or stable release needs justify it |
| Split by product family                     | Allows tooling, UI, or a standalone integration to evolve separately  | More than one integration and release path                                           | A possible later step, based on actual coupling                       |

Keep `ternent/core` as the development repo for now. Preserve useful standalone
interfaces. Make extraction possible through declared dependencies and a portable
tooling package, without spending the migration budget on a repo split.

Do not merge independently useful Identity, Armour, or Seal behavior into Concord merely
to simplify builds. Review every additional public interface for a concrete consumer
need. Independent releases are the default for real standalone packages.

## Evidence from this checkout

Inspected at `8f78367` on 2026-10-20; these are static configuration findings,
alongside the earlier build evidence in the [project brief](../concord/context.md).

- Eight package directories have manifests, but Concord and Ledger are excluded
  from workspace membership. Workspace uses registry versions of those packages.
- The declared graph includes Identity → Armour → Seal, with Seal also depending
  on Utils and Identity. Concord depends on Ledger; Workspace depends on Concord,
  Ledger, Armour, and Identity. These arrows describe dependency flow from lower
  layers to consumers, not a complete runtime import graph.
- Ledger names absent workspace packages `@ternent/concord-protocol` and
  `@ternent/seal-cli`. Those names need reconciliation with the current sources.
- Package manifests span Vite major versions 2, 4, and 7, and multiple declaration
  strategies. Some tests build first, others do not; Utils uses a watch-capable
  `vitest` command rather than an explicitly one-shot test command.
- `scripts/vite/package-lib-config.ts` centralizes externalization for some
  packages, but consumers import it through repo-relative paths.
- Seal's test configuration aliases sibling source, including absent legacy
  directories. Its proof source imports `ternent-utils` while its manifest
  declares `@ternent/utils`. Aliases can conceal published-consumer failures.
- UI exports Vue modules and CSS; Seal combines library exports and a Node CLI.
  They have different build needs from plain TypeScript libraries.
- Release selection uses a hard-coded package list in `.ops/publish.mjs` and
  separate package workflows. The inspected workflows do not run the test suite.
- `.nvmrc` selects Node 23.7.0; the root has no `packageManager` pin. Runtime
  support and toolchain runtime are not expressed as a shared contract.

These findings support a shared contract. They do not demonstrate that repository
co-location is the cause of the failures, or that every package needs replacement.

## The contract: what every package promises

The published package is the external seam. Its interface includes JavaScript,
types, supported environments, assets, dependency requirements, and failure modes.

### Inputs

Each package declares:

- Its public exports, executable commands, assets, dependency ranges, and runtime
  support in `package.json`; this remains the public metadata source of truth.
- A small build description: profile, source entries, compile targets, and any
  required asset generation. Metadata already in the manifest is not duplicated.
- Tests for its observable behavior and consumer fixtures for supported environments.

Shared policy supplies formatter/linter settings, TypeScript settings, output
conventions, dependency externalization, and package checks. Package variation
must be explicit and justified; arbitrary copied configurations are not the default.

### Outputs and dependency rules

- Every declared export and `bin` target exists in the packed artifact. Every
  public TypeScript-facing export has usable declarations. CSS and WASM assets
  required by consumers are present and resolve from the installed artifact.
- Prefer ESM for new libraries. Preserve existing public paths and supported
  formats during migration unless a deliberate compatibility change is agreed.
- Build into `dist`, with explicit filenames and source maps. Set targets per
  supported environment; syntax lowering alone cannot supply missing runtime APIs.
- Externalize declared runtime and peer dependencies for normal library outputs.
  Any self-contained browser distribution is a separate, tested output profile.
- Public types referencing another package require an appropriate published
  dependency or peer relationship, not an undeclared workspace convenience.
- Imports between packages use declared public exports. Consumer verification
  cannot use sibling-source aliases, root aliases, or accidental hoisting.
- In a monorepo, use an explicit workspace dependency policy for local packages.
  In published artifacts, dependency ranges must resolve without workspace access.
- One package's build does not recursively build its siblings. The repository
  runner prepares dependencies in graph order; a standalone repo installs them.

### Commands

| Command          | Meaning                                                               |
| ---------------- | --------------------------------------------------------------------- |
| `fmt:check`      | Read-only Oxfmt check for the selected scope                          |
| `lint`           | One-shot Oxlint check with agreed correctness rules                   |
| `typecheck`      | Explicit type verification, including Vue-aware checks where needed   |
| `test`           | One-shot behavior tests with a meaningful failure exit status         |
| `build`          | Produce this package's complete declared outputs from prepared inputs |
| `check:package`  | Validate and exercise the packed artifact as an external consumer     |
| `check:artifact` | Validate the delivery artifact: npm tarball or private app bundle     |
| `check`          | Run the required gates with their dependencies prepared               |

Watch mode is a separate `dev` or `test:watch` command. Checks do not publish or
silently edit files. A formatter or lint-fix command is an explicit write action.
Missing required scripts or skipped packages fail contract validation.

The repository runner owns graph scheduling: install and validate manifests;
build dependencies; run checks with available declarations; pack the candidate
set; verify consumers. Fast source tests remain useful during editing. The final
gate also tests the real candidate dependency graph, including affected dependents.

## Shared implementation

Use a versioned development-only `@ternent/tooling` package. Its small
interface exposes supported config profiles and package validation. It owns the
repeated implementation of those policies; application packages own behavior.
It must not depend on runtime packages or require its own build to bootstrap.
Plain executable ESM plus published config files is a suitable starting point.

Use the existing tools through shared presets rather than inventing a general
build system. Start with three concrete profiles:

| Profile            | Packages or outputs                                      | Additional obligations                                                         |
| ------------------ | -------------------------------------------------------- | ------------------------------------------------------------------------------ |
| TypeScript library | Identity, Armour, Seal, Concord, and proven integrations | Declarations, public imports, explicit environment support                     |
| Node CLI           | Seal's executable, alongside its library outputs         | Executable permissions/shebang, `bin` resolution, CLI smoke check              |
| Vue library        | Portable Vue fixture                                     | Vue declarations, framework peer policy, CSS/theme assets and browser consumer |

One package can use library and CLI profiles. Browser distributables and WASM
loading are capabilities to validate where needed, not assumptions applied to
every library. Every profile passes the same artifact-level contract.

Vite+ supplies the selected Oxfmt/Oxlint/Vite/Rolldown/tsdown/Vitest integration and
task runner. Keep an explicit type-checking gate, Vue-aware checks and profile fixtures.
Use vp pack for library builds, followed by actual candidate tarball creation and
external-consumer proof. Experimental tsrs is a non-publishing canary until equivalence
and measured repository results support promotion. See the concrete profile and
bootstrap exceptions in [the repository architecture](repository-architecture.md).

The tooling package should be installable by version from a separate repository.
Do not import `../../scripts/...` or extend unpublished root configs. Toolchain
upgrades become deliberate dependency updates with fixture tests for each profile.
Choose supported Node LTS and exact package-manager/tool versions during the pilot;
keep development runtime and published-package runtime promises separate.

## Proof that a package works

Run package metadata/type validation, then install the actual tarball in an
isolated consumer outside the workspace. Supply candidate sibling tarballs through
a temporary registry or equivalent isolated resolution of the exact release set.
Do not silently substitute already-published siblings for changed candidates.

Exercise advertised imports and subpaths, compile a TypeScript consumer, and run
representative behavior. Add browser, CLI, CSS, or WASM fixtures for claimed
capabilities. Check supported dependency-range compatibility as well as the latest
candidate set when an interface change could invalidate that range.

The Workspace missing-entry-point failure must fail this gate. So must an import
of an undeclared old package name that only succeeds through a test alias.

## Release contract

Keep Changesets for proposed independent versions. A coordinated release can
include several packages without forcing them to share a version. Decide any
fixed groups from consumer compatibility needs, not directory layout.

Use one shared verification workflow and graph-derived release selection.
Publish only artifacts built and checked from the release revision, after all
gates pass. Preserve exact verified tarballs/digests through the publish step;
publish dependencies before consumers and verify registry availability. Record
partial publication so retries do not invent or overwrite versions.

A release check establishes technical readiness; it is not authorization to
publish. Follow the user's release authorization separately.

## Migration and design sequence

1. Choose supported Node versions, browsers, and module formats for the clean rebuild.
2. Pilot the tooling contract on the new Identity package, including packed-consumer
   checks and normative Ed25519-to-X25519 vectors.
3. Apply the library profile to Concord as the document protocol and runtime are built;
   verify every public subpath from a packed external consumer.
4. Validate Armour and Seal's standalone outputs and Seal Action. Let these real
   variations shape shared presets before adding more profiles.
5. Add storage or framework packages only for proven integrations, and exercise them
   against packed Concord artifacts rather than sibling source aliases.
6. Consider repository extraction only after package interfaces and independent
   installation are proven. Tooling upgrades then remain portable either way.

## Resolved direction and remaining setup

The [alpha blueprint](../concord/implementation-blueprint.md#6-toolchain-and-implementation-order)
now selects ESM/ES2022, Node 22/24 verification lanes, and a pinned browser fixture for
new alpha packages. The repository target now selects a pinned supported Node 24
development runtime, Vite+, independent UI, private hosted apps, npm OIDC publication,
and Cloudflare Workers Static Assets. Exact compatible pilot pins and legacy consumer
compatibility remain implementation/migration work.

Account IDs, actual Worker names/domains, npm publisher identities, and the existing
Seal Action's consumer expectations must be checked during their implementation steps.
They do not block the portable tooling/library pilot. No existing compatibility promise
is changed merely by recording this clean target.

## References

- [pnpm workspaces](https://pnpm.io/workspaces): explicit local dependency resolution
  and conversion of workspace ranges when packing/publishing.
- [Changesets fixed packages](https://changesets.dev/guide/fixed-packages): fixed
  groups version and publish together; this is separate from repository layout.
- [tsdown](https://tsdown.dev/guide/) and its
  [package validation](https://tsdown.dev/options/lint): candidate library tooling,
  including optional publint and declaration-resolution checks.
- [Developer archetype](developer-archetype.md): the engineering practice this
  contract is intended to make executable.

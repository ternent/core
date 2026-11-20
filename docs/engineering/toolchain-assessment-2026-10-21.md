# Toolchain assessment, 2026-10-21

This is dated supporting evidence for the [repository target](repository-architecture.md),
not a benchmark or a claim that its pilot passes. Recheck versions, peer ranges, supported
file types, and provider behavior before implementation.

## Checkout observations

At revision `8f78367`, with pre-existing working-tree edits preserved:

- Node reports 23.7.0, pnpm 10.33.4, Oxfmt 0.50.0. Root has no packageManager pin;
  formatting uses defaults. There is no installed root Vite+/Oxlint setup.
- Concord and Ledger remain commented out of workspace membership. The new protocol
  and runtime are design artifacts, not verified published candidates.
- The release workflow depends on commit-message text. `.ops/publish.mjs` loops over
  a fixed package list and creates releases from parsed PR text. Per-package tag
  workflows separately build/publish without behavior gates.
- Some workflows use checkout@master and deprecated set-output syntax. Changesets
  declares restricted access, while package tag publishers request public access.
- No checked-in Wrangler app/deployment architecture was found in the inspected tree.
  Cloudflare account resources, custom domains, and npm trusted publishers have not
  been inspected or configured.
- UI declares Vue, Vite and framework helpers inconsistently across dependency roles;
  IdentityGlyph directly imports SerializedIdentity. The target removes that domain
  coupling from the UI product's public interface.
- Seal still imports `ternent-utils` while declaring the scoped utility package. This
  supports an isolated-package consumer gate; it does not justify keeping that helper
  package in the clean target.

No legacy package build or behavior suite was rerun for this assessment. No dependency
was installed or updated. No release, npm account change, Cloudflare change, or GitHub
workflow was executed.

## Researched capabilities and decisions

| Surface           | Verified documentation on this date                                                                   | Architectural decision                                                                       |
| ----------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Vite+             | The guide names Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt and Vite Task; references release 1.3.0 | Use as the primary interface, pinned after the profile pilot                                 |
| Library build     | vp pack uses tsdown and a pack block in vite.config.ts                                                | One library/CLI/Vue family; keep npm tarball creation separate                               |
| Vue               | tsdown documents unplugin-vue and Vue declarations                                                    | Prove Vue profile; retain vue-tsc for templates/types                                        |
| Lint coverage     | Oxlint describes framework script-block linting                                                       | Do not claim Vue template lint coverage from script lint alone                               |
| Type-aware checks | Vite+ documents TypeScript Go/tsgolint                                                                | Typed lint now, checker promotion only after project parity tests                            |
| tsrs              | Cloudflare's October 20 announcement calls the npm release experimental                               | Non-publishing comparison lane, no release dependency                                        |
| Node              | Bundled Vitest documentation requires recent 22/24 minors or 26                                       | Tooling uses a pinned supported Node 24 patch; library runtime support is separately checked |
| Task graph        | Vite Task documents dependency-field task references and fail-if-no-match                             | Native scheduling; no invented Turbo syntax or silent empty filters                          |
| npm               | Trusted publishing supports GitHub-hosted OIDC and explicit workflow/environment/action configuration | One direct publishing workflow, current tested npm CLI, package-level onboarding             |
| Cloudflare        | Static Assets and Worker Previews are documented; Previews requires Wrangler 4.135.0+                 | Static UI hosting, current Preview flow, one GitHub-controlled deployer                      |

Sources: [Vite+ guide](https://viteplus.dev/guide/),
[library build](https://viteplus.dev/guide/pack),
[Vue recipe](https://tsdown.dev/recipes/vue-support),
[Oxlint supported files](https://oxc.rs/docs/guide/usage/linter),
[Vite+ types](https://viteplus.dev/guide/check),
[tsrs announcement](https://blog.cloudflare.com/typescript-rust-port),
[test runtime](https://viteplus.dev/guide/test),
[task graph](https://viteplus.dev/guide/run),
[npm trust](https://docs.npmjs.com/trusted-publishers/),
[static hosting](https://developers.cloudflare.com/workers/static-assets/),
[Worker Previews](https://developers.cloudflare.com/workers/previews/get-started/).

Vite+ is an integration/distribution choice, not a claim every module runs in Rust.
Its typed lint path currently includes Go; Vitest and Vue tooling retain their own
implementations. A consistent toolchain can use these while taking Oxc's actual
benefits. Writing Concord itself in Rust or implementing an in-browser build system
does not follow from the linked compiler announcement and is outside this work.

## Required pilot fixtures

| Fixture                          | Proof                                                                                                                         |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Neutral TS library with subpaths | ESM imports in Node/browser, declarations, external runtime dependency, no source aliases                                     |
| Library + Node CLI               | Import has no CLI side effects; packed bin runs with correct shebang; browser entry excludes Node imports                     |
| Vue component library            | Typed props/events, intentional template errors, public declarations, explicit CSS/theme exports, production consumer styling |
| Vue SPA                          | HMR, build, browser startup/deep route, candidate library behavior, static Cloudflare bundle                                  |
| VitePress docs                   | Compatible peer/tool resolution, compiled code examples, real static 404, component gallery CSS                               |
| Tooling itself                   | No build bootstrap cycle, self public imports, install tarball in a second empty repository                                   |
| Deliberately broken artifacts    | Absent export, undeclared dependency, stale declaration, missing CSS, wrong bin and source-only alias each fail               |
| Automation fixtures              | Exact tarball retry, version collision, changed digest, missing candidate sibling, failed deployment/rollback                 |

Run these from empty artifact directories and after a normal warm incremental edit.
Use a fixture with an actually failing assertion to prove every test command exits
nonzero; an empty test selection is not success. Prove lint/parser/formatter scopes
with representative TS, Vue, CSS, JSON/JSONC, YAML, Markdown, and automation ESM files.
Record any unsupported class with an explicit fallback or scoped limitation.

## Checker comparison protocol

Keep the current selected upstream checker authoritative while evaluating alternatives.
For plain TS, run its complete project graph and the candidate checker against exactly
the same files, flags, generated inputs, and installed declarations. For Vue, compare
template-aware outputs independently; a TS-only pass cannot replace them.

Include missing imports, wrong public command inputs, Promise misuse, nullability,
generic inference, discriminated unions, module resolution, declaration consumers,
and the repo's actual protocol/model interfaces. Save expected failures as fixtures.
Normalize diagnostic ordering and path separators; compare code, severity, location,
and meaning. Do not silently discard a diagnostic because its text or order differs.
Compare declaration consumption and runtime conformance in addition to diagnostics.

Canary output includes candidate/baseline versions and commits, inputs, diagnostic
diff, elapsed time, peak memory, and exit states. A candidate crash is a visible canary
failure, not a release failure. Promotion requires resolved semantic differences and
all relevant profile/consumer checks. Change only the profile's authoritative checker,
keep a reproducible previous pin, and record why; no permanent double-checking of the
same surface merely to avoid making the compatibility decision.

## Performance evidence template

Record machine/OS/CPU/memory, worker limits, runtime/tool versions, checked package/file
counts, cold/warm definitions, and cache-hit state. Compare five runs per scenario and
report median plus range; keep install, format, lint, types, tests, build, artifact proof,
and browser startup separate. Use equal scope and equivalent diagnostics, then report
the full `check` path as well as individual tasks. Account for tool startup and output
restoration rather than quoting an upstream compiler benchmark as repository speed.

Required scenarios: clean complete check; one register reducer edit; one Identity public
type edit with affected dependents; one UI CSS edit; root tooling/config update; and a
no-change warm check. Publish the measured results in this document or a dated successor
after R1/R2. No timings have been collected for the new stack in this design task.

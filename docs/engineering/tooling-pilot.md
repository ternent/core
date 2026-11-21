# Tooling pilot

This report records the R1 foundation scope. The active checks now also cover
Identity, Armour and the [Concord first slice](alpha-first-slice.md); use that report
for the current prerequisites and acceptance scope.

R1 implements the shared tooling foundation. The active workspace contains
`@ternent/tooling` and five private profile fixtures: TypeScript library, Node CLI,
Vue component library, Vue application, and VitePress documentation. Product
packages in `packages/` remain legacy evidence pending their explicit migrations.

## Run the pilot

Use Node **24.21.0** (`nvm use`) and pnpm **10.33.4**, then:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

Linux CI installs Chromium with `--with-deps`. The first browser installation needs
network access. Isolated consumer installation can also access the public npm
registry for external dependencies; candidate package names always resolve to the
exact locally packed tarballs. No credentials are needed. Root `.npmrc` sets the
public registry and a repository-local store; it contains no account configuration.

`pnpm check` reports distinct contract, format, build, typed lint, TypeScript,
behavior, and consumer gates. `pnpm fmt` writes only the pilot scope. `pnpm test`
runs source behavior tests once; `pnpm test:watch` is the explicit watch command.
Tests importing sibling packages require their built public outputs; use
`pnpm build` first when invoking a leaf check directly after a clean checkout.

The new `ci.yml` workflow repeats installation and `pnpm check` on Ubuntu 24.04,
with read-only repository permissions and pinned action commits. GitHub execution
is a separate verification environment; local checks do not establish a remote
workflow result.

## Implemented contracts

`tooling/tooling` ships executable ESM, hand-authored public declarations checked
alongside the implementation, and published TypeScript presets. It needs no build
to load its own configuration. Profile factories expose explicit source entry maps
and reject unsupported build options. Vite Task schedules declared dependencies
before consumers; profile tasks disable caching during the pilot. No package build
recursively invokes sibling builds, and no source alias replaces a public import.

Package manifests own exports, dependencies, assets, and bins. The validator checks
required gates, ESM metadata, semantic versions, publication access, path containment,
declared output existence (including wildcard assets and old entry fields), CLI
shebang/permissions, undeclared emitted imports, and Node imports in neutral libraries.
Declarations and CSS are first-class outputs. Hidden pack/publish build hooks fail.

`check:artifact` in a leaf package validates its local output. The root consumer
gate supplies the additional tarball installation and executable proof; a leaf
validation alone is not a release acceptance check.

The external consumer installs four exact tarballs (tooling, library, CLI, Vue
library) with candidate-name overrides and no workspace link. It checks public
imports and subpaths, CLI behavior, usable declarations and intentional type errors,
then builds a fresh library and a Vue app outside this checkout. Each profile carries
the same formatting and typed-lint policy into that external installation. Chromium checks
the installed component's styling and interaction, direct SPA navigation, docs,
and missing-asset/404 responses. A deliberately failing behavior test must return
a failure status; intentional formatting and floating-promise errors must also fail
with useful diagnostics, without the format check rewriting its input. Validator
regressions also cover missing outputs, stale names,
missing CSS, path traversal, invalid entry maps, and malformed executable metadata.

## Exact toolchain and compatibility findings

| Component                      | Pilot pin         |
| ------------------------------ | ----------------- |
| Node / pnpm                    | 24.21.0 / 10.33.4 |
| Vite+                          | 1.3.0             |
| TypeScript / Node types        | 5.9.3 / 24.3.0    |
| Vue / vue-tsc                  | 3.5.44 / 3.3.13   |
| Vue Vite plugin / unplugin-vue | 6.0.10 / 8.0.0    |
| VitePress / Playwright         | 1.6.4 / 1.64.1    |

The installed `vp --version` reports Vite 8.3.4, Rolldown 1.2.14, Vitest 5.0.5,
Oxfmt 0.73.0, Oxlint 1.88.0, tsgolint 7.0.2004, and tsdown 0.23.1. Their bundled
versions stay together. Experimental tsrs is not installed. TypeScript and Vue
checking remain explicit; lint success does not imply type-check success.

The pilot exposed these concrete integration requirements:

- Pin Node types across the workspace. Different peer resolutions otherwise load
  separate Vitest instances and cause every suite to fail during registration.
- The Vite+ core package alias reports distribution version 1.3.0 while exposing
  Vite 8.3.4. The narrow pnpm peer allowance is exercised by the profile fixtures.
- VitePress retains its supported nested Vite 5 build. Its workspace also declares
  the Vite+ core alias so the test runner does not resolve through VitePress's Vite.
- VitePress 1.6.4 ships a self-referencing `anchor.Token` declaration. A committed
  pnpm patch aliases the existing outer Token type, preserving its actual shape.
  The docs profile declares Web Bluetooth ambient types explicitly. Dependency
  type checking remains enabled; remove the patch when a checked upgrade fixes it.
- Volar's public TypeScript dependency imports `@volar/language-service` without
  publishing that dependency. Tooling declares the tested 2.4.28 peer explicitly.
- Optional Vue plugin backends expose unrelated bundler types. A small runtime
  adapter loads the declared optional peers without requiring webpack/Bun/Farm
  backend types in every tooling consumer.
- The Vue packer emits `dist/style.css`; the fixture exports and browser-checks
  that actual path. CLI packing preserves the shebang and executable mode.
- Vite Task 1.3 rejects combining `-r` and `--filter`; filtered tasks use
  `--fail-if-no-match` without `-r`. Missing selections cannot silently pass.

## Evidence and remaining work

Verified locally on **2026-10-22**, macOS arm64 / Node 24.21.0:

- Frozen-lockfile installation passed.
- All nine `pnpm check` gates passed, including 17 tests across six suites and the
  packed/browser/failure checks described above.
- The observed gate total was **49.0 seconds**, with dependency/browser caches warm
  and task caching disabled. This is one measured pilot run, not a speed comparison
  with the legacy repository or a CI timing promise.
- Final diff checks passed; the existing runtime test edit is unchanged and the
  original root TypeScript configuration is preserved byte-for-byte.

`artifacts/pilot-check.json` records gate exit codes and elapsed times.
`artifacts/pilot-consumers.json` records candidate paths, SHA-256 digests, and
consumer checks; `artifacts/pilot-browser.png` captures the production app.
Tarballs remain beside those reports. These are reproducible local acceptance
artifacts, not committed generated output or a performance comparison.

The original root TypeScript configuration is retained as `tsconfig.legacy.json`.
Existing product source and prior edits are preserved. The pilot does not run
legacy package checks, old `.ops` automation, or the former Vite helper scripts.
Existing release workflows remain legacy and must not be used for this pilot;
the single replacement npm/Cloudflare release lane arrives in R5. No packages
have been published and no Cloudflare resources have been provisioned or deployed.

Local static serving exercises artifact routing, not Cloudflare's deployed routing.
The application Wrangler file is a configuration fixture only. Node 22 compatibility,
other browsers, npm OIDC, production domains, registry retries, and deployment rollback
remain acceptance obligations of their later increments. The next product increment
is Identity with its normative vectors, followed by Armour and Concord's first slice.

See [ADR 0013](../adr/0013-pilot-candidate-isolation.md) for the isolated consumer
decision and [the delivery sequence](repository-architecture.md#6-replacement-and-acceptance-sequence).

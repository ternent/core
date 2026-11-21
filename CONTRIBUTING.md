# Working on core

Install the Node version in `.node-version` (also mirrored in `.nvmrc`) and the
pnpm version in `package.json#packageManager`. Then:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

On Linux, install browser system dependencies with
`pnpm exec playwright install --with-deps chromium`. Armour's interoperability
tests also need `age` 1.3.1; CI installs its checksum-verified official binary.

| Command                               | Feedback                                                    |
| ------------------------------------- | ----------------------------------------------------------- |
| `pnpm fmt`                            | Format active workspace files                               |
| `pnpm fmt:check`                      | Check formatting without writing                            |
| `pnpm build`                          | Build workspace outputs in dependency order                 |
| `pnpm lint`                           | Typed Oxlint checks                                         |
| `pnpm typecheck`                      | Repository automation types                                 |
| `pnpm -r typecheck`                   | Package TypeScript and Vue declarations                     |
| `pnpm test`                           | All active behavior tests                                   |
| `pnpm --filter @ternent/concord test` | Focus on one package                                        |
| `pnpm check:artifact`                 | Exact packed consumers; requires built outputs and Chromium |
| `pnpm check`                          | Complete acceptance gate                                    |

Local packed checks use the current Node executable. To include compatibility
lanes, set `CONCORD_NODE22` and `CONCORD_NODE24` to explicit executable paths.
CI supplies both and sets `VERIFY_COMPATIBILITY=true`, requiring those lanes.
There is no dependency on a contributor's Node version manager or home layout.

The checked development toolchain is Node 26; product consumers retain the
Node 22.18 minimum. Vite+ supplies the build, formatter, typed linter and tests.
The `typescript` dependency aliases `@typescript/typescript6` for the compiler API
used by Vue/Volar and declaration tooling; invoke its `tsc6` CLI for explicit types.
Do not silently replace this with the incompatible TypeScript 7 compiler API.

Keep signed vectors and observable behavior tests when refactoring. Test public
imports, declarations and exact tarballs when changing package structure.
Formatting, types, behavior, browser and installed-package checks prove different
things. Report an unavailable check as unavailable, preserving its failing exit.
Acceptance evidence is written under ignored `artifacts/`.

Changes to active package selection belong in `pnpm-workspace.yaml`. Keep runtime
dependencies with their owning product; portable tooling must not know this
repository's package names. Retire unused source instead of copying it into a
legacy directory. Preserve unrelated working edits.

The single CI workflow verifies candidates with read-only repository permissions.
Publishing and deployment are separate backlog work; merging does not publish npm
packages. Dependency update configuration is in `renovate.json`; the repository
owner must enable Renovate for it to open update PRs.

# Working on core

Use the Node version in `.node-version` (mirrored in `.nvmrc`) and the pnpm
version in `package.json#packageManager`:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

On Linux, install browser system dependencies with
`pnpm exec playwright install --with-deps chromium`. Armour's interoperability
tests also need `age` 1.3.1; CI installs its checksum-verified official binary.

| Command                                | Feedback                                                     |
| -------------------------------------- | ------------------------------------------------------------ |
| `pnpm fmt`                             | Format active workspace code and selected repository files   |
| `pnpm fmt:check`                       | Check formatting without writing                             |
| `pnpm build`                           | Build the five libraries in dependency order                 |
| `pnpm lint`                            | Typed Oxlint checks                                          |
| `pnpm typecheck`                       | Repository automation types                                  |
| `pnpm -r typecheck`                    | Package types                                                |
| `pnpm test`                            | Active library behavior tests                                |
| `pnpm --filter @ternent/concord test`  | Focus on one package                                         |
| `pnpm --filter @ternent/concord check` | Build that package and its dependencies, then run its checks |
| `pnpm check:artifact`                  | Exact packed consumers; requires built outputs and Chromium  |
| `pnpm check`                           | Complete acceptance gate                                     |
| `pnpm test:release`                    | Release plan, retry, integrity and Seal trust tests          |
| `pnpm release:version`                 | Review registry history, apply Changesets and record intent  |
| `pnpm release:plan`                    | Freeze accepted tarballs and reports from committed source   |

For a small formatting change, use explicit paths with `pnpm exec vp fmt`.
Package `check:artifact` scripts run `publint --strict --pack false` on built
outputs. The root artifact check also lints each exact tarball before installing
it by name/version outside the workspace through a disposable loopback registry.
Sibling packages resolve only from that candidate registry, without overrides;
negative probes verify missing candidates and incompatible dependency ranges fail.

Local packed checks use the current Node executable. Set `CONCORD_NODE22` and
`CONCORD_NODE24` to explicit executable paths to include compatibility lanes.
CI supplies both and sets `VERIFY_COMPATIBILITY=true`, requiring them. Checks do
not depend on a contributor's version manager or home directory layout.

Development uses Node 26; published libraries declare Node 22.18 as their minimum.
Vite+ supplies builds, Oxfmt, typed Oxlint and tests. Root `vite.config.base.ts`
and `tsconfig.base.json` hold ordinary shared defaults; package configs own public
entries, environment differences and output paths. pnpm owns dependency ordering.
The `typescript` dependency aliases `@typescript/typescript6` for declaration and
compiler API compatibility; use its `tsc6` CLI for explicit type checking.
There is no Vue SFC, Volar or portable tooling-profile contract in this workspace.

Keep signed vectors and observable failure cases when refactoring. Public imports,
declarations, CLI behavior, import isolation and exact tarballs need their own
checks. The temporary Vue render consumer proves production CSS, interaction and
browser cryptography; it does not certify a component library or documentation
site. Formatting, types, behavior and installed consumers establish different
properties. Report unavailable checks honestly and preserve failing exit statuses.
Current run reports, candidate digests and the browser screenshot are written to
ignored `artifacts/`.

`pnpm-workspace.yaml` selects exactly Identity, Armour, Ledger, Concord and Seal.
Keep runtime dependencies with their owning library and use declared public
exports between packages. Preserve unrelated edits. Retire unused source instead
of creating legacy archives; Git keeps history. UI and Workspace remain excluded.
See the [repository guide](docs/engineering/repository-hygiene.md) for ownership
and check boundaries.

The read-only CI workflow verifies candidates and exercises the pinned Seal Action
on a retained release bundle with a disposable test identity. Merging does not publish npm
packages or deploy applications. Release automation and registry acceptance remain
on the [release backlog](docs/engineering/release-and-deployment.md).
`renovate.json` configures dependency updates; the owner must enable Renovate for
it to open PRs.

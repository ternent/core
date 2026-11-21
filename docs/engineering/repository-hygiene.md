# Repository hygiene

Implemented 2026-11-21. This describes the working repository; the older
[architecture proposal](repository-architecture.md) includes release and deployment
work that is still on the [shipping backlog](shipping-inventory-2026-11-20.md).

## Toolchain

| Tool                      | Pin                                 | Reason                                                          |
| ------------------------- | ----------------------------------- | --------------------------------------------------------------- |
| Node                      | 26.13.1                             | Current LTS security release; development and CI                |
| pnpm                      | 12.21.0                             | Exact root package manager; install policy in workspace YAML    |
| Vite+                     | 1.7.0                               | Build, Oxfmt, typed Oxlint, tests and tasks                     |
| TypeScript compiler API   | `npm:@typescript/typescript6@6.0.2` | Vue/Volar and declaration compatibility; explicit `tsc6` checks |
| Vue / vue-tsc             | 3.5.46 / 3.3.14                     | Current compatible Vue toolchain                                |
| Playwright                | 1.65.1                              | Installed-package production browser checks                     |
| typage (`age-encryption`) | 0.3.1                               | Armour's TypeScript age implementation                          |
| Noble curves / hashes     | 2.4.0 / 2.4.0                       | Identity cryptography; retained vectors verify compatibility    |
| Scure base / bip39        | 2.4.0 / 2.4.0                       | Identity encoding and recovery phrases                          |

Vite+ uses its native TypeScript engine for typed lint. TypeScript 7's compiler API
does not replace the TypeScript 6 API required by Volar; the alias makes that
dependency explicit. VitePress remains on its latest stable 1.6.4, with the existing
narrow recursive-token declaration patch. The old Vite+ distribution-version peer
override is gone: the current core alias reports a compatible Vite 8 version.

pnpm 12 reads install policy from `pnpm-workspace.yaml`; `.npmrc` only declares the
registry. Build scripts are allowed for esbuild only. Exact Vue 3.5.46 packages
are listed as release-age exceptions for this reviewed upgrade; other packages
retain pnpm's default supply-chain policy.

## Structure and checks

`pnpm-workspace.yaml` is the package inventory. Root test discovery, formatting and
lint derive their package paths from pnpm's workspace inventory. Build and type
checks recurse over the same selection. Portable profiles accept root test paths
and the verification command rather than embedding Ternent package names.

Repository acceptance code lives in `scripts/verify/`. Explicit Node executable
inputs replace the old assumption about NVM directory layout. Local packed checks
always run the current runtime; CI additionally requires Node 22.18 and 24.21.
The development tooling requires Node 26 while the product library minimum remains
22.18. Chromium remains a required acceptance check.

One read-only CI workflow installs the exact lockfile, age reference binary and
browser, then retains check reports and candidate tarballs. Third-party actions
are pinned to verified release commit SHAs. The old tag/package publishers and
`.ops/publish.mjs` are removed. A verified-artifact release planner and publisher
remain B14/B15; CI does not publish npm packages or deploy applications.

`renovate.json` configures reviewed dependency updates, including the runtime and
action pins. Toolchain updates are grouped, and no updates merge automatically.
The owner must enable Renovate on the repository for PR creation.

## Source cleanup

Removed copied `legacy/` implementations under Identity, Armour and Concord, plus
the retired Ledger and Utils products. The copied archives matched the committed
review checkpoint before removal; Git retains the implementations. Useful Identity
serialization/recovery helpers now live in `src/serialized.ts`. Armour's private
engine and error names describe age rather than the removed Rage implementation.

Concord's private `runtime/` modules own host validation, result validation,
system-output validation and model folding. The runtime retains command queues,
drafts and atomic state publication together. This extraction preserves function
bodies and public exports.

Workspace remains excluded because its test file contains a separate pre-existing
working edit. Its retirement needs that work reconciled. UI remains excluded pending
its migration; `scripts/vite` still supports that unmigrated build. These directories
are not part of the new package checks or release candidates.

Root README, contribution instructions and ISC license explain the actual setup.
Dated planning documents remain evidence, with links to this implemented state;
they do not certify current tests or completed publication.

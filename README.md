# Ternent core

Identity, encryption, signed documents and standalone proofs for software where
the host owns its data and storage.

| Package                                 | Responsibility                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- |
| [Identity](packages/identity/README.md) | Seed identities, signatures, recovery and key derivation                  |
| [Armour](packages/armour/README.md)     | age encryption through the TypeScript implementation, typage              |
| [Ledger](packages/ledger/README.md)     | Standalone signed log, staging, commits, verification and replay          |
| [Concord](packages/concord/README.md)   | Commands, authority, encrypted groups and application replay above Ledger |
| [Seal](packages/seal/README.md)         | Standalone proofs, encrypted artifacts, manifests and a Node CLI          |

These five independently usable libraries are the active workspace and release
scope. Ledger owns the common signed container and history lifecycle. Concord
composes commands, authority and encryption above it. Staging is in memory;
consumers choose commit cadence and own any draft persistence or recovery.

Use Node **26.13.1** and pnpm **12.21.0**:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

The acceptance gate checks contracts, formatting, builds, lint, types and behavior,
then validates exact tarballs with publint and installs them in an isolated
Node/browser consumer. The temporary Vue browser consumer uses ordinary render
functions and CSS. See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites and
focused checks. A configured check is not a release receipt.

`packages/` owns the libraries, `scripts/verify/` owns repository acceptance,
and `docs/` owns contracts and decisions. Root Vite+ and TypeScript base configs
share repository defaults; each package declares its own entries and outputs.
There is no portable tooling product or maintained application in core. UI is
outside this release under [ADR 0017](docs/adr/0017-drop-ui-from-the-library-release.md).
Workspace remains deferred until the libraries are stable and substantial demos
exist. Demos should consume published libraries from outside core.

Start with the [project brief](docs/concord/context.md),
[alpha architecture](docs/concord/alpha-architecture.md) and
[repository guide](docs/engineering/repository-hygiene.md). Signed history is
authoritative; projections are derived, and storage publication is a separate step.
Candidate-registry checks and the release planner/publisher are implemented. CI
exercises Seal proofs over retained candidate bundles. Production workflow wiring
and registry onboarding remain on the [release backlog](docs/engineering/release-and-deployment.md).

ISC licensed. See [LICENSE](LICENSE).

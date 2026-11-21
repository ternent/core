# Ternent core

Identity, encryption, signed documents and standalone proofs for software where
the host owns its data and storage.

| Package                                 | Responsibility                                                            |
| --------------------------------------- | ------------------------------------------------------------------------- |
| [Identity](packages/identity/README.md) | Seed identities, signatures, recovery and key derivation                  |
| [Armour](packages/armour/README.md)     | age encryption through FiloSottile's TypeScript implementation, typage    |
| [Concord](packages/concord/README.md)   | Framework composition, authority, encrypted groups and application replay |
| [Seal](packages/seal/README.md)         | Standalone proofs, encrypted artifacts, manifests and a Node CLI          |
| [Ledger](packages/ledger/README.md)     | Standalone signed log, staging, commits, verification and replay          |

The five public products are Identity, Armour, Ledger, Concord and Seal. They are
alpha candidates using one Ledger-owned container and history lifecycle. Isolated candidate-registry verification,
the verified-artifact publisher and registry acceptance remain on the
[shipping backlog](docs/engineering/shipping-inventory-2026-11-20.md).
The existing UI and Workspace directories are excluded from the active workspace.
Tooling is private repository infrastructure pending simplification; apps, profile
fixtures and overlapping planning documents remain cleanup work. There is no
maintained UI package in the v1 release; see
[the UI scope decision](docs/adr/0017-drop-ui-from-the-library-release.md).
Workspace work is deferred until the libraries are stable and a substantial set of
demos has been built; it does not block the library release.

Use Node **26.13.1** and pnpm **12.21.0**:

```sh
pnpm install --frozen-lockfile
pnpm check
```

The full check builds public outputs, checks formatting, lint and types, runs
behavior tests, installs exact tarballs into an isolated consumer, and exercises
production Vue and docs builds in Chromium. See [CONTRIBUTING.md](CONTRIBUTING.md)
for setup and focused commands.

`packages/` owns product code, `tooling/` currently holds private development helpers,
`fixtures/` and `apps/handshake/` prove consumption, and `scripts/verify/` owns
repository checks. Workspace selection lives in `pnpm-workspace.yaml`; root checks
derive package paths from that selection. Historical implementations belong in Git.

Start with the [project brief](docs/concord/context.md),
[alpha architecture](docs/concord/alpha-architecture.md) and
[repository guide](docs/engineering/repository-hygiene.md). Signed history is
authoritative; projections are derived, and storage publication is a separate step.

ISC licensed. See [LICENSE](LICENSE).

# Ternent core

Identity, encryption, signed documents and standalone proofs for software where
the host owns its data and storage.

| Package                                 | Responsibility                                                        |
| --------------------------------------- | --------------------------------------------------------------------- |
| [Identity](packages/identity/README.md) | One Ed25519 identity: create, back up, recover, sign and verify       |
| [Seal](packages/seal/README.md)         | Detached Ed25519 proofs over a content hash                           |
| [Armour](packages/armour/README.md)     | age encryption for identities, group keys and passphrases             |
| [Ledger](packages/ledger/README.md)     | Signed, append-only history of JSON entries, verified on open         |
| [Concord](packages/concord/README.md)   | Shared documents of application events with private, encrypted groups |

These five independently usable libraries are the active workspace and release
scope. Ledger owns signed history, Seal signs each commit, Armour encrypts, and
Concord builds shared documents with private groups on top. Applications own
storage, sync and UI. [CONTEXT.md](CONTEXT.md) defines the vocabulary.

Agents building applications should start with [llms.txt](llms.txt), which links
to each package’s consumer interface guide and working examples.

Use Node **26.13.1** and pnpm **12.21.0**:

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

The acceptance gate checks contracts, formatting, builds, lint, types and behavior,
then validates exact tarballs with publint and installs them in an isolated
Node/browser consumer. See [CONTRIBUTING.md](CONTRIBUTING.md) for prerequisites and
focused checks. A configured check is not a release receipt.

`packages/` owns the libraries and `scripts/` owns repository acceptance and release.
Each package's README describes its interface and guarantees, and its `CLAUDE.md` the
rules for changing it.

ISC licensed. See [LICENSE](LICENSE).

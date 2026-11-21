Current repository state: [repository hygiene](repository-hygiene.md). The observations below describe the earlier slice.

# Identity, Armour and the Concord first slice

2026-11-20 follow-up: [B02's primitive-interface note](primitive-interfaces-2026-11-20.md)
records explicit Identity exports and removal of Armour's obsolete initialization
requirement. Earlier reuse/evidence statements below describe the original increment;
they are not a requirement to preserve its initialization API.

The active workspace now includes `packages/identity`, `packages/armour` and
`packages/concord` alongside the R1 tooling and profile fixtures. This implements
R2 and the private immediate-commit path in R3: create → dispatch/commit → export →
open → verify → replay → inspect. It does not claim the complete board or complete
standard-profile-1 implementation.

## Reuse and architectural changes

| Area     | Reused                                                                                                                                       | Architectural change                                                                                                                          |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity | Existing seed, mnemonic, Ed25519/X25519 and age conversion helpers; original helper tests                                                    | Added a strict public identity and exact-byte signer capability; scoped/zeroed private scalar callback; ESM profile and verified declarations |
| Armour   | Existing identity/text/binary/passphrase/recipient interfaces, error mapping and behavior tests                                              | Replaced the Rage dependency with a private adapter over pinned TypeScript age; added init-free binary operations and capability composition  |
| Concord  | Existing behavioral requirements for strict integrity, atomic replay publication, read-only operation and deterministic saved-history replay | Implemented the accepted new signed format and lifecycle directly; the old Ledger/Seal/plugin format cannot be renamed into that contract     |
| Tooling  | R1 profile factories, artifact validator, graph scheduling and isolated candidate overrides                                                  | Extended the same checks to the real products, supported Node consumers and actual encrypted browser behavior                                 |

Legacy Identity `signBytes`/`signUtf8` retain their context prefix. New capability
`sign` accepts exactly the supplied bytes; Concord never substitutes the legacy
helper. The old Armour helpers retain explicit initialization and default ASCII
armor output, while new `encryptAge`/`decryptAgeWithSecret` use binary age without
initialization. Those compatibility choices preserve tested behavior without
mixing document semantics into the primitives.

Original package sources, tests, metadata, guidance and configurations are retained
under each migrated package's `legacy/` directory. These are reference snapshots,
excluded from checks and publication. Identity's retained implementation is active
at `src/serialized.ts`; Armour's existing helpers remain active over the new private
engine port. Neither is a wrapper around the previous Concord runtime.

The existing edit to `packages/workspace/test/runtime-core.test.ts` is outside this
migration. Other legacy packages remain outside the active workspace. Their previous
failures have not been reclassified as successes or repaired speculatively.

## Implemented ownership and behavior

- Identity owns strict point and identity validation, raw signatures, seed custody,
  X25519 conversion and canonical age/base64 encodings. Its retained mnemonic and
  serialized-identity helpers remain host conveniences.
- Armour composes Identity with `age-encryption` **0.3.1**. It does not spawn age or
  load WASM in production. The independent **age 1.3.1** executable is a test oracle.
- Protocol owns bounded duplicate-detecting UTF-8/JSON parsing, exact numeric token
  validation, canonical bytes, closed schemas, identifiers, signatures, lineage and
  snapshot comparison. It has no runtime, model, Armour or Seal import requirement.
- Standard system owns `system.init`, owner authority, wrapped epoch-0 material,
  contextual private events and complete decryption before model replay. Secrets
  remain behind profile-private session tokens. It checks all public entries before
  attempting reader decryption.
- Runtime owns serialized authoring, resource checks before signing, complete
  candidate verification/replay and atomic publication. State, bytes and reports
  detach at public seams. Expected failures return results or inspection; unexpected
  extension exceptions produce sanitized diagnostics.
- Models own command validation, event meaning and reducers. The exact register
  model is an example under `/testing`, not runtime policy. Model callbacks are
  synchronous, pure functions without a `this` dependency.

Ready exports are canonical snapshots; invalid/locked/incompatible/freshness
inspection exports preserve the original bytes. Read-only readers can reconstruct
without signing. No storage publication is hidden in dispatch. Unknown or deferred
security events are incompatible, never ignored.

## Run the current checks

Use Node **24.21.0** and pnpm **10.33.4** for the development lane, plus
**Node 22.18.0**, **age 1.3.1**, and the pinned Playwright Chromium installation for
independent consumers. With nvm, the consumer check discovers the sibling Node
22.18.0 executable. Otherwise set `CONCORD_NODE22` to its executable path. The
GitHub workflow records that path before switching back to the development runtime.

```sh
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
pnpm check
```

The root command validates all active manifests, formats only active code, builds
the graph, runs typed lint, checks tooling/root/fixture/product types, runs behavior
tests, packs the exact candidate set and installs it outside the workspace. Package
tests use sibling public exports rather than source aliases or registry predecessors.

The external consumer exercises all public Concord subpaths and the full lifecycle
on Node 22/24; verifies the independent owner vectors; compiles typed command
successes and intentional failures; and blocks runtime/model/age imports while
verifying through `/protocol`. Chromium builds and runs actual private authoring,
decryption, reopening and replay against the installed tarballs. Native-age tests
cover both encryption directions and saved independent ciphertext.

CI pins the age 1.3.1 Linux archive by its release SHA-256 and pins both Node lanes.
The CI definition has not itself been run remotely in this task. No release or
Cloudflare deployment has been attempted.

## Acceptance evidence

Behavior cases live in the migrated packages' `test/` directories; immutable
reference artifacts remain in `docs/concord/vectors/`. The reference bytes have not
been rewritten to match the implementation. Negative semantic fixtures re-sign
through an independent Node-crypto author rather than the verifier under test.

The final full workspace run passed all **10 gates**, **103 tests across 12 suites**,
all **nine package builds**, strict types and typed lint, independent native age,
exact packed Node 22/24 imports and Chromium. The 23 original Identity/Armour helper
tests remain active. Frozen-lockfile installation also passed after recreating the
migrated packages' generated dependency directories.

The observed full-run gate total was **70.4 seconds** with warm dependency/browser
caches and task caching disabled. This measures the expanded scope, not a speed
comparison with R1 or the legacy packages.

Original snapshots were compared byte-for-byte with the prior tracked revision:
seven Identity files, 20 Armour files and 13 Concord files. The two tracked generated
Identity config bundles are preserved in place and excluded from active formatting
and lint. The pre-existing Workspace test edit retains its original SHA-256.

The checks cover the P/C/R first-slice areas: unsafe and malformed input, strict
identity/signature vectors, metadata/ciphertext/signature tampering, missing and
detached records, ordering/linkage/selectors, unsupported limits/requirements,
lineage/freshness, locked/read-only handling, event context and reducer failures,
author failure atomicity, concurrent operations, immutable public values, and
extension output coverage/actor binding. Source tests are separate from the packed
Node/browser checks and declaration checks.

Machine-readable current outcomes, candidate digests and elapsed gates are in
`artifacts/pilot-check.json` and `artifacts/pilot-consumers.json`; the production
browser proof is `artifacts/pilot-browser.png`. These are generated acceptance
artifacts, not a new source of protocol expectations or a benchmark against legacy.

## Limits at the close of the original increment

- Draft mode is not implemented in this increment; requesting it returns
  `HOST_CONFIGURATION`. Immediate `commit()` correctly returns `NO_DRAFT`.
- Member set/remove and audience rotation remain Step 4. Their valid signed records
  return `UNSUPPORTED_SYSTEM_EVENT`; no management function is exported as a stub.
- Full historical admission, revocation, grant/administer cases and the board
  walkthrough are acceptance gates of the next increments.
- The old Concord interface and `concord-ledger`/Seal wire records remain archived
  reference material. There is no silent import conversion or compatibility claim.
- Package candidate versions are provisional alpha versions, separate from wire
  version 1. Registry version allocation and legacy Seal/Action compatibility are
  checked during their own release/migration work.
- Other browsers and deployed Cloudflare routing remain unverified. Local static
  serving is not a production deployment test. Existing legacy release workflows
  must not be used for this candidate set; the single replacement publisher/deployer
  remains R5.
- Custom asynchronous profiles must honor the no-reentry host contract. Synchronous
  callback reentry is rejected; automatic detection across arbitrary host awaits is
  not implemented. The official profile follows the contract. See
  [ADR 0014](../adr/0014-keep-async-profile-reentry-a-host-contract.md).

The original roadmap paired drafts with the membership increment and used the board
for the publication proof. The local handshake now comes first. Drafts, the reusable
expected-head storage proof, and the board remain separate increments.

## Standard membership and local handshake follow-up (2026-11-16)

Concord now exposes `setMember` and `removeMember` through `/system`. The same
serialized immediate-commit path verifies signed candidates and replays both stages
before publishing state. Tests exercise bounded grants, full history on admission,
revocation, audience rotation, read-only reopening, and divergent histories. The
packed Node 22 and Node 24 consumers exercise admission, replay, and removal using
the public imports.

The [handshake pilot](../../apps/handshake/README.md) uses one private Concord
document per artifact. A live sender and recipient ran in separate ephemeral Codex
sessions using the local stdio server. After they exited, the invited reader verified
the saved receipt offline against the proposal. Release produced the exact 34 bytes
of the disposable source artifact. The automated built CLI smoke also exercises
invalid acceptance, duplicate publication, tampering, changed artifact bytes,
rollback, and divergence relative to a remembered head.

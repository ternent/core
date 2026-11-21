# Library shipping inventory and implementation backlog

Prepared 2026-11-20. First-review deliverable from
`/private/tmp/ternent-core-shipping-handoff-2026-11-20.md`.
This records inspected sources and proposed implementation slices; it does not
claim that the remaining migration or publication is complete.

## Release boundary and provenance

Ship six independently consumable npm products: `@ternent/identity`,
`@ternent/armour`, `@ternent/concord`, `@ternent/seal`, `@ternent/ui`, and
`@ternent/tooling`. Keep the existing handshake and tooling-profile fixtures as
regression consumers. No new product app, Workspace product, hosted deployment,
public Ledger, catch-all Utils, or replacement protocol project belongs to this
release.

The source checkout is `/Users/sam/dev/samternent/home`, observed at
`6e7195933f5c850cf846ccfba3292c0fe3d9c738`. The target is
`/Users/sam/dev/ternent/core`, observed at
`8f783675d8ae75de4ee383e81effdb9c86607565` on `main`, with extensive modified and
untracked migration work. HEAD alone does not identify the target implementation.
The source also has unrelated working changes; it was inspected without changes.
Preserve both checkouts' existing edits. This report is the only authored change
in this pass; the baseline also regenerated ignored build and evidence artifacts.

In tables below, `home/` means the source checkout and unprefixed paths are relative
to core. A disposition of **omit** means no v1 port/publication; it does not authorize
deleting the original source. Behavior can survive without preserving its old API,
package name, dependency chain, or wire format.

Read with [repository ownership](repository-architecture.md),
[package profiles](package-tooling-contract.md),
[release contract](release-and-deployment.md),
[current migration evidence](alpha-first-slice.md),
[alpha architecture](../concord/alpha-architecture.md), and
[canonical language](../../CONTEXT.md). The handoff's library-first scope supersedes
the older board/docs deployment sequence. Its accepted group behavior supersedes
the single-document-audience limitation; detailed replacement schemas remain to
be written and reviewed in B01.

## Source package disposition

All 26 direct `home/packages/*/package.json` manifests are accounted for below.
References identify implementation or fixture evidence, not a demand to copy it.

| Source directory / package                                           | Capability and evidence                                                                                                        | Target owner / disposition                                                                                                                                                                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `identity-v2` / `@ternent/identity`                                  | Seed identity, mnemonic/serialized helpers, signing, X25519/age derivation; `src/index.ts`, tests                              | **Retain useful behavior** in Identity. `src/serialized.ts` ports helpers; `src/strict.ts` supplies capability signing and strict validation. Audit the final public surface in B02.                                            |
| `identity` / `ternent-identity`                                      | Older key import/export/signing; `src/index.ts` and referenced modules                                                         | **Replace** with Identity's seed/capability interface. Do not restore an older key representation solely for compatibility.                                                                                                 |
| `armour` / `@ternent/armour`                                         | Recipient, identity, passphrase, text and binary encryption; `src/`, `test/`                                                   | **Retain** in Armour with the existing TypeScript age port. Keep one engine and Identity-owned conversion.                                                                                                                  |
| `encrypt` / `ternent-encrypt`                                        | String encryption/decryption and key generation; `src/index.ts`                                                                | **Replace** with Armour operations; no second encryption wrapper product.                                                                                                                                                   |
| `rage` / `@ternent/rage`                                             | Native/WASM age wrapper and Node/browser tests                                                                                 | **Replace engine**, not product: Armour uses pinned `age-encryption`. Reuse relevant interoperability/error cases, not WASM build infrastructure.                                                                           |
| `ragejs` / `ternent-rage-wasm`                                       | Older WASM encryption bindings                                                                                                 | **Omit** bindings/runtime initialization. Armour owns required age behavior.                                                                                                                                                |
| `concord-protocol` / `@ternent/concord-protocol`                     | Canonical subjects, chain traversal, hashing, validation; `src/{index,canonical,crypto,epochs}.ts`                             | **Consolidate** signed-history mechanics into `packages/concord/src/protocol/` and `/protocol`. Old format/epoch semantics are evidence, not a compatibility contract.                                                      |
| `concord-protocol-wasm` / `concord-protocol-wasm`                    | Rust/WASM implementation/build                                                                                                 | **Omit** separate shipping artifact and Rust prerequisite. Language-neutral vectors remain useful; no new cross-language implementation required here.                                                                      |
| `concord-test-vectors` / private `@ternent/concord-test-vectors`     | `vectors.json`, malformed-value token conventions                                                                              | **Retain applicable cases** under `docs/concord/vectors/` and protocol tests. Keep current independent alpha vectors authoritative; do not substitute legacy expected hashes.                                               |
| `ledger-v2` / `@ternent/ledger`                                      | Signed container, staged entries, commits, replay/decryption; `src/{ledger,types}.ts`, tests                                   | **Consolidate** into Concord protocol/runtime/system. No public Ledger, no dependency from Concord to Seal CLI. Draft semantics remain a runtime gap.                                                                       |
| `ledger` / `ternent-ledger`                                          | Earlier runtime, staged state, transforms, storage plugins; `src/ledger.ts`, `src/plugins/{indexedDB,loki}.ts`                 | **Reuse behavior evidence** for runtime/drafts/storage boundaries. Omit Loki projection persistence and old runtime product; storage remains outside trusted replay.                                                        |
| `concord` / `@ternent/concord`                                       | Commands, replay plugins, read-only and partial replay; `src/{app,types,errors}.ts`                                            | **Replace architecture while retaining contracts** with typed models, explicit system pass and atomic runtime replay. No arbitrary plugin ordering or trusted partial reconstruction.                                       |
| `concord-plugin-identity` / `@ternent/concord-plugin-identity`       | Principal records and identity replay; `src/{replay,schemas}.ts`, fixtures                                                     | **Split ownership**: Identity validates cryptographic identity; Concord system binds signer/authority. Profiles/names remain app data; omit standalone plugin.                                                              |
| `concord-plugin-permissions` / `@ternent/concord-plugin-permissions` | Grants, scope/membership timing, authorization; `src/{auth,replay,schemas}.ts`, fixtures                                       | **Consolidate applicable cases** into Concord system. No independent package or wholesale import of legacy delegation/expiry policy. B01 must explicitly delimit retained capabilities.                                     |
| `concord-plugin-encryption` / `@ternent/concord-plugin-encryption`   | Epoch rotation, wraps, decryption explanations; `src/{replay,resolution,schemas}.ts`, fixtures                                 | **Consolidate** audience/key-distribution behavior into Concord system; Armour encrypts. Retain useful malformed-wrap/rotation cases, not a parallel security registry.                                                     |
| `concord-plugin-task` / `@ternent/concord-plugin-task`               | Task create/edit/status, validation and reducers; `src/plugin.ts`, `test/task-plugin.test.ts`                                  | **Application model evidence** only. No task package or board app in this release. Use a small test model where needed to prove group isolation and replay.                                                                 |
| `concord-inspector` / `@concord/inspector`                           | Chain summary, semantic replay, cannot-grant/decrypt explanations; `src/{replay,explain}.ts`                                   | **Consolidate useful diagnostics** into runtime `inspect()` and system reports. No separate inspector package or UI security reimplementation.                                                                              |
| `concord-cli` / `@concord/cli`                                       | Init/append/verify/inspect/identity/permission/encryption commands; `src/commands/`, README                                    | **Omit separate CLI product**. Its verification/error cases inform Concord tests; the release's CLI is Seal.                                                                                                                |
| `seal-cli` / `@ternent/seal-cli`                                     | Proof/artifact/manifest APIs and Node CLI; `src/`, `bin/seal`, tests                                                           | **Migrate to `@ternent/seal`** in `packages/seal`. Retain standalone composition/offline verification; resolve Utils imports, declarations and package-name drift.                                                          |
| `ternent-ui` / private `ternent-ui`                                  | Vue primitives/patterns, tokens/themes, older `S*` components; source barrels, tests, theme scripts                            | **Migrate intentional surface to `@ternent/ui`**. Preserve target design work; no blanket restoration of old components or app-specific themes. B08–B10.                                                                    |
| `utils` / `ternent-utils`                                            | Byte/string encoding, hashes/canonicalization, old key/armor formatting, IDs, color helpers; `src/index.ts`, tests             | **Distribute to owning modules or omit**, as detailed below. No public Utils package.                                                                                                                                       |
| `ternent-ledger-vue` / private `ternent-ledger-vue`                  | Vue composition around legacy Ledger; `src/index.ts` and modules                                                               | **Omit current adapter**. A framework adapter can follow a real new-runtime consumer later; no crypto/replay ownership in UI.                                                                                               |
| `solid` / `@ternent/solid`                                           | Pod resource storage/access, wallet unlock/backup, profiles/people, app/workspace manager; `src/index.ts` and exported modules | **Defer integration package** outside six-product scope. Identity/Armour supply primitives; provider I/O stays adapter-owned; people/profiles/managers remain app composition. Do not pull Solid dependencies into Concord. |
| `pixpax-core` / `@ternent/pixpax-core`                               | Catalog, deterministic issuance, transfer/claim validation/projection; `src/index.ts`                                          | **Defer application domain**. Do not migrate card/pack policy into Concord or Utils.                                                                                                                                        |
| `pixpax-issuer` / `@ternent/pixpax-issuer`                           | Issuance/proof authoring; `src/{issuance,proofs}.ts`                                                                           | **Defer application domain**; useful as later independent Seal/Identity consumer.                                                                                                                                           |
| `pixpax-concord` / `@ternent/pixpax-concord`                         | Pixbook command/replay plugin; `src/plugin.ts`                                                                                 | **Defer application model**; no new model product or migration app required for library shipping.                                                                                                                           |

`@ternent/tooling` has no corresponding portable source package in that manifest
set. The implemented target `tooling/tooling` owns reusable dev-only profiles and
validation; old copied package build configs are replaced by those profiles.

## Additional source evidence and capability ownership

The source package list alone misses the independent-group implementation:

- `home/apps/solid/src/app/plugins/permissions.ts` and corresponding
  `packages/workspace/src/plugins/permissions.ts` create group keys, encrypted
  grants and encrypted metadata. `applyPermissionRevoke` removes membership but
  does not rotate keys. Retain the model, repair the revocation limitation.
- `packages/workspace/src/runtime/privacy.ts` selects audiences and decrypts
  available content. This moves to Concord system replay, not a new Workspace.
- `home/apps/concord-demo/src/route/workspace/WorkspaceTodo.vue` and
  `home/apps/concord-demo/src/module/ledger/useLedger.ts` demonstrate task/list
  groups, assignments, staged changes, storage and application-managed keys.
  Tasks/lists/assignments stay application policy; key distribution/decryption and
  signer-bound authorization move to Concord system; I/O stays adapter-owned.
- `packages/workspace/src/runtime/{createApp,storage}.ts`, `storageProviders/`,
  `runtimeCore/`, `plugins/{users,identityKey}.ts`, `runtime/{qr,totp}.ts`, and
  `workspaceLifecycle.ts` contain composition, provider and host conveniences.
  Do not port them as a public Workspace or silently expand this release to
  account/profile/QR/TOTP services. Only required document lifecycle behavior moves
  to its accepted owner.

### Utils disposition

| Existing helper family (`home/packages/utils/src/index.ts`; target equivalent) | Final owner / action                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `canonicalStringify`, `hashData`                                               | Concord already owns its stricter canonical input domain and signed subjects. Seal needs a private, format-defined canonicalizer for its proof/manifest subjects. Do not make Seal depend on Concord or assume the two formats accept identical values. Carry exact useful byte vectors. |
| `hashBytes`, `getHashBuffer`, `getHashArray`, `getHashHex`                     | Keep only the necessary internal hashing/hex helpers in Seal; protocol hashing remains Concord-owned. Use platform/library primitives rather than exporting the old helper chain.                                                                                                        |
| Base64 conversions, `b64encode/b64decode`, `encode/decode`                     | Identity owns identity encodings; Armour owns ciphertext encoding. Seal may have narrow internal byte encoders where its format requires them. Drop redundant aliases and permissive key parsing.                                                                                        |
| `stripIdentityKey`, `formatIdentityKey`                                        | Old key-format conveniences are not a new identity contract. Remove from release code where unused; Identity owns any deliberately retained parsing/serialization.                                                                                                                       |
| `stripEncryptionFile`, `formatEncryptionFile`, `addNewLines/removeLines`       | Use Armour/age's encoding implementation where needed. No separate public armor formatter.                                                                                                                                                                                               |
| `generateId`                                                                   | App-generated IDs stay above runtime; authored nonces/time/randomness must be captured before replay. Omit general utility export.                                                                                                                                                       |
| `generateColorStops`                                                           | UI-local presentation helper only if a retained component uses it; otherwise omit. No crypto dependency for color rendering.                                                                                                                                                             |

## Fresh baseline and observed gaps

The interactive shell initially selected Node 22.18.0; development gates require
24.21.0. The baseline command explicitly prepended the installed pinned executable:

```sh
env PATH="/Users/sam/.nvm/versions/node/v24.21.0/bin:$PATH" pnpm check
```

The run completed with exit code **1**. The first ten gates passed: contract,
format, graph build, lint, tooling/root/fixture/product types, behavior and
handshake artifact checks. Behavior reported **119 tests across 14 files**;
the built handshake CLI/MCP smoke tests reported **2 passes**.

The eleventh gate, consumers, passed isolated candidate installation, Identity/
Armour/Concord lifecycle and vectors on Node **22.18.0 and 24.21.0**, protocol
import isolation, public imports/CLI/types, and external library/Vue app builds.
It then failed launching Chromium: macOS sandbox denied Mach-port registration
(`bootstrap_check_in ... Permission denied (1100)` at
`scripts/verify/consumers.mjs:243`). No browser assertions ran in this attempt;
later consumer checks were not reached. This is an environment-blocked gate, not
evidence of an application assertion failure. No assertions were weakened or
browser checks skipped to report success.

The existing runner wrote `artifacts/pilot-check.json` and
`artifacts/pilot-consumers.json`; its scope is **alpha-first-slice**, not the
complete release. The captured console log is
`/tmp/ternent-shipping-baseline-2026-11-20.log`. Seal and UI remained outside this
run. Full-release checks, fresh real UI/Seal package acceptance, remote CI success,
current npm versions/trust configuration and registry consumption remain
unverified. This documentation-only pass introduced no implementation failure.

| Area                | Inspected implementation                                                                                                                                       | Remaining shipping gap                                                                                                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity            | `src/index.ts` exports strict capabilities and helper implementation from `serialized.ts`; local profile/public ESM exports                                        | Decide which helper APIs remain useful host conveniences, verify Seal's actual needs; avoid compatibility-only exports. Preserve strict signature/key/encoding vectors and mnemonic behavior selected for v1. |
| Armour              | One TypeScript age engine; capability and convenience APIs; local Identity dependency                                                                          | Audit deliberate init/helper surface and errors. Description still says Rage. Preserve independent age interop, malformed input and unauthorized decryption checks.                                           |
| Concord protocol    | Canonical signed history, independent `/protocol`, snapshot comparison                                                                                         | Keep existing vectors/negative cases; update only group envelope contract required by B01. Old and new format support must be explicit, without a compatibility mandate.                                      |
| Concord system      | `ProtectedEvent.audience`, `ApplicationIntent.audience`, standard replay and runtime dispatch fix `"document"`                                                 | Independent groups, per-group epochs/rotation/history grants, writer-created groups and owner access only through an actual grant.                                                                            |
| Concord replay      | Standard profile requires active read and every epoch key; runtime cross-checks replay output                                                                  | Read all available content with explicit locked-entry evidence. A scoped application view must not claim full reconstruction; tampering/decrypt failures with available keys remain failures.                 |
| Concord drafts      | `host()` rejects draft mode; `draft()` returns null; `commit()` returns `NO_DRAFT`                                                                             | Implement explicit grouped authoring with provisional preview and atomic failure retention. Immediate remains default.                                                                                        |
| Storage             | `/testing` has copied-buffer memory store; runtime accepts/exports bytes                                                                                       | Expected-head proof and failure/conflict semantics belong outside runtime. Do not turn storage into trust or add transport/merge.                                                                             |
| Seal                | Excluded workspace; proof/artifact/manifest import `ternent-utils`, manifest declares `@ternent/utils`; stale source aliases include absent `identity-v2`/Rage | Internal Utils ownership, real local public imports, shared library/CLI build, declarations and package docs. Existing tests do not establish packaged behavior.                                              |
| UI                  | Excluded workspace; root points to `dist/components.js`, build entries are primitives/patterns; no declared types                                              | Real entry/declaration/CSS/theme outputs, Vue peer/externalization, lean exports, useful interaction checks.                                                                                                  |
| UI ownership        | `IdentityGlyph/identityGlyph.types.ts` imports undeclared Identity; utils parse DID/base58/Ed25519                                                             | Presentation input and deterministic glyph rendering in UI; identity validation/conversion above UI.                                                                                                          |
| Tooling/check scope | Existing profiles/fixtures work; root test globs and pilot scripts enumerate current slice                                                                     | Include Seal/UI intentionally; preserve UI `src/**/*.test.ts` discovery when adopting a profile whose default is `test/**/*.test.*`. Add targeted policy failures.                                            |
| Packed consumers    | Pilot installs exact candidate tarballs using explicit sibling overrides                                                                                       | Good existing proof, but overrides can hide broken final sibling ranges. Final release requires isolated candidate registry resolution without those overrides.                                               |
| Release             | CI plus legacy release/tag publishers coexist; `.changeset/config.json` uses restricted access; no target planner/publisher scripts                            | Single verified-artifact path, version intent, collision/retry tests, public access, OIDC/account setup, registry-installed consumers.                                                                        |

The frontend inventory's read-only `validatePackage("./packages/ui")` diagnostic
returned 11 findings: missing profile, five required scripts, public access and
four declaration conditions. The diagnostic-print command exits zero; that is
not a passing validation gate. No fresh UI/Seal build was claimed by that check.

The standalone Seal Action is locally available at
`/Users/sam/dev/samternent/seal-action`, observed at
`d07a683a9195a1190c3e15b6e4374a1d59592b57`. Its `action.yml` and
`scripts/run.sh` default to `@ternent/seal-cli@latest`, but already accept
`package-name`/`package-version` and `cli-command`. Core can prove the command
sequence against `@ternent/seal` without altering the Action repository. This
inspection is not an executed GitHub Action or verified registry installation.

## Ordered implementation backlog

Every item is a deliverable with an observable exit. Dependencies indicate ordering,
not permission to broaden its scope. Proposed new files below are destinations,
not claims that those files already exist. CI and package work can proceed on
independent paths after the contract review.

### B01 — Specify the minimal group and readable-view contract

Progress, 2026-11-20: Sam accepted separate memberships in
[ADR 0015](../adr/0015-keep-audience-memberships-independent.md). A concrete
[design draft](../concord/group-profile-design.md), 19 proposed acceptance cases
and a saved semantic scenario defined the implementation scope. B03/B04 now implement
the contract and add signed group vectors; see the dated implementation note below.
One audience per command is also accepted in
[ADR 0016](../adr/0016-route-each-command-to-one-audience.md); draft mode may group
commands across audiences in one commit.

- **Evidence:** handoff decisions; Workspace permission/privacy sources above;
  `packages/concord/src/{protocol/types.ts,system/types.ts,system/standard.ts,runtime.ts}`;
  existing standard-profile/conformance docs.
- **Targets:** `docs/concord/{standard-profile,alpha-protocol,implementation-blueprint,conformance}.md`,
  focused new vectors, and a short ADR if needed. **Depends on:** this inventory review.
- **Scope:** name group/audience identifiers, authority to create/grant/remove,
  per-group epochs, encrypted historical grants, contextual binding, encrypted
  descriptive metadata, event audience selection, and explicit readable/locked
  replay outputs. Document unavoidable cleartext and a model's response to locked
  dependencies. Preserve system-before-application replay and atomic publication.
  No anonymous envelopes, trial-decryption routing, speculative metadata hiding,
  transport, or merge. No automatic owner access. Join/rejoin grants full group
  history; removal rotates future keys without pretending old keys disappear.
- **Acceptance:** concrete saved examples show two groups in one signed document,
  a document owner outside one group, admission/removal/re-admission and a reader
  with one group locked. Define which checks remain public and which require keys.
  Missing keys, invalid ciphertext and invalid authority have distinct results.
  Resolve last group administrator/removal and document-membership effects
  explicitly. Agree the smallest schema/API delta before implementation.

### B02 — Settle Identity and Armour's intentional public surface

Implementation, 2026-11-20: [primitive-interface changes and verification](primitive-interfaces-2026-11-20.md)
record the explicit Identity surface, retained host helpers and init-free Armour.
Seal's initializer calls are removed; its full package migration remains B06/B07.
Fresh package/browser acceptance limits are reported separately in that note.

- **Evidence:** `home/packages/{identity-v2,armour}/src/` and retained tests;
  `packages/{identity,armour}/{README.md,SPEC.md,src/index.ts}`; Seal crypto callers.
- **Targets:** those exports/docs/manifests and relevant tests/consumer fixtures.
  **Depends on:** inventory review; coordinate Seal input needs with B06.
- **Scope:** retain useful seed/mnemonic/serialization and encryption conveniences,
  prune only demonstrated obsolete compatibility paths, document strict vs
  contextual signing and init behavior, and correct stale Rage descriptions.
  No new identity recovery/continuity mechanism or crypto rewrite.
- **Acceptance:** saved identity/signature/conversion vectors remain exact;
  malformed encodings/points/signatures fail; secret callback cleanup and wrong
  recipient/passphrase paths pass; selected convenience APIs work on installed
  Node/browser packages. Seal has no need for an absent/private export.

### B03 — Implement independent groups in system authoring and replay

Implemented locally, 2026-11-20: independent authoring/membership/epochs, scoped
authority, historical grants and group-specific rotation. See
[independent group implementation and verification](independent-groups-2026-11-20.md).

- **Evidence:** B01, Workspace group sources, legacy encryption/permission negative
  fixtures; current `system/{audience,membership,authoring,standard}.ts`.
- **Targets:** `packages/concord/src/{protocol,system}/`, necessary runtime routing,
  `test/membership.test.ts`, new focused group tests. **Depends on:** B01, B02.
- **Scope:** group creation by document writers, signer-bound authority,
  independent key epochs, encrypted grants carrying every historical group key,
  rotation on removal, grant-only owner access. Keep cryptography in Identity/Armour.
- **Acceptance:** two independent groups share one document; authorized creation
  succeeds without owner approval, unauthorized actor/spoofed signer fails;
  admission/re-admission decrypts saved history; removed member cannot decrypt new
  epochs or author beyond authority; other groups continue unaffected. Re-signed
  malformed semantic fixtures fail in the system layer, separately from ordinary
  tampering failing protocol validation.

### B04 — Publish readable views with explicit locked entries

Implemented locally, 2026-11-20: exhaustive readable/locked replay, explicit model
opt-in, coverage metadata and raw readable inspection evidence after successful
system replay. Verification and environmental limits are recorded in the
[implementation note](independent-groups-2026-11-20.md). B05 now also implements drafts.

- **Evidence:** B01; `system/standard.ts` all-key/read checks,
  `system/types.ts`, `model/types.ts`, runtime evaluation/output checks;
  Workspace privacy service and inspector explanations.
- **Targets:** those Concord files, inspection reports and runtime/group tests.
  **Depends on:** B03.
- **Scope:** verify complete reachable signed history, complete the system pass,
  then supply available events and stable locked markers/facts to the agreed
  application contract. Label scoped reconstruction and retain read-only behavior.
  Do not silently drop events or present partial state as full-document state.
- **Acceptance:** identical saved bytes and capabilities replay identically;
  different readers see only decryptable content plus truthful locked evidence;
  revoked reader can inspect readable history without gaining current write rights;
  forged/missing reachable history or available-key authentication/context failure
  cannot publish trusted state. A late model failure publishes no intermediate
  projection; a locked cross-group dependency follows B01's explicit model policy.

### B05 — Complete draft authoring

Implemented locally, 2026-11-20: volatile previews, committed-only reads/export,
ordered atomic commits across commands/audiences, signed metadata, discard and
failure-preserving retries. See [draft implementation and verification](draft-authoring-2026-11-20.md).
The reusable storage proof is also implemented in B12 below.

- **Evidence:** `home/packages/ledger-v2/src/ledger.ts`, legacy Concord staging,
  current `model/types.ts` and runtime stubs; blueprint draft cases.
- **Targets:** `packages/concord/src/runtime.ts`, model types, focused draft tests
  and package README. **Depends on:** B03–B04 for the final authoring path.
- **Scope:** immediate default; opt-in draft mode, provisional preview,
  ordered commands in one signed commit, explicit commit/discard, separate export
  and storage publication. Define pending-draft lifecycle and system-command behavior.
- **Acceptance:** multiple commands leave committed head/history unchanged until
  explicit commit, then produce one correctly bound commit in order. Validation,
  encryption/signing or replay failure retains prior committed state and usable
  draft. Discard/reopen/export follow the agreed staged-state contract. Read-only
  and inspection handles reject authoring. No hidden storage write.

### B06 — Migrate Seal's library contract and internal helpers

Implemented locally, 2026-11-20: standalone public Identity/Armour composition,
Seal-owned canonical helper, strict signer/signature verification, immutable async
inputs and independent fixed proof evidence. Wire proof/public-key v2 and
artifact/manifest v1 remain selected. See [Seal migration and verification](seal-migration-2026-11-20.md).

- **Evidence:** `home/packages/seal-cli/src/`, current `packages/seal/src/`,
  Utils helper table, existing proof/artifact/manifest/crypto tests and CLAUDE guidance.
- **Targets:** `packages/seal/src/{proof,artifact,manifest,crypto,index}.ts`, a narrow
  internal utility module, tests, README and format contract. **Depends on:** B02.
- **Scope:** reuse existing proof/artifact behavior, remove Utils dependency/name
  mismatch, consume public local Identity/Armour, explicitly define accepted
  canonical values and chosen format versions. Do not import Concord to hash Seal
  subjects or maintain aliases merely for unused old callers.
- **Acceptance:** fixed subject bytes/signatures and offline verification work;
  changed subject, signer/key ID, signature, manifest or encrypted payload fail;
  intended recipient decrypts and unrelated identity fails. Every chosen library
  subpath is browser-safe and has usable types. No source alias or unscoped Utils
  import conceals dependency resolution.

### B07 — Activate Seal's library/CLI package and Action command proof

Implemented locally, 2026-11-20: shared Node CLI build/profile, typed browser-safe
public paths, executable bin, active workspace/root gates and installed candidate
command proof. The standalone Action is unchanged; its command sequence is tested
against the local candidate. See [the implementation note](seal-migration-2026-11-20.md).

- **Evidence:** `packages/seal/{package.json,vite.config.ts,bin/seal,src/cli.ts,test/cli.test.ts}`;
  tooling CLI fixture; inspected standalone Action command sequence.
- **Targets:** Seal manifest/build/type config, `pnpm-workspace.yaml`, lockfile,
  root gates, isolated CLI/Action fixture. **Depends on:** B06, B11.
- **Scope:** shared profile, separate Node CLI from browser API graph, declarations
  for public exports, executable bin, public access, correct package docs/name.
  Remove absent sibling-source aliases. Use the existing Action's configurable
  package/command inputs; no cross-repository edit or action release in this task.
- **Acceptance:** installed tarball imports every public path; bin help,
  identity creation, manifest/sign/verify/public-key sequence and documented exit
  codes work from a clean external directory. Browser proof import pulls no Node
  filesystem globals. Assert failures against wrong bytes/proof/key config.

### B08 — Activate a lean typed UI package

- **Evidence:** `home/packages/ternent-ui/src/{primitives,patterns}/`, current
  barrels/manifest/build; `fixtures/tooling-profiles/vue-library/`.
- **Targets:** `packages/ui/package.json`, explicit root entry, profile-based
  build/tsconfig, workspace/lock/root gates and README. **Depends on:** B11.
- **Scope:** retain intentional target primitives/patterns, fix root entry,
  generate Vue declarations, use external Vue as peer, separate build-only tools.
  Proposed exclusions: old `S*` bundle, misspelled `Accordian` aliases, broken
  `src/main.js` app scaffolding, unused compatibility exports. Inventory real usage
  before pruning; source-only `concordos` theme is not a required port.
- **Acceptance:** root/primitives/patterns import from installed tarball; prop/event
  declarations accept correct usage and reject deliberate misuse; no duplicate
  bundled Vue or dependency on checkout-relative config. All retained tests are
  discovered; missing root output fails validation before publishing.

### B09 — Keep identity glyphs presentational

- **Evidence:** current `patterns/IdentityGlyph/` types and DID/base58 parser;
  `home/packages/ternent-ui/src/patterns/IdentityGlyph/identityGlyph.utils.test.ts`.
- **Targets:** UI glyph types/utils/components/barrels and applicable restored tests.
  **Depends on:** B08.
- **Scope:** consume stable presentation input, preserve deterministic visual
  behavior/fallback/contrast; move identity parsing and validation to its owner or
  the consuming adapter. No Identity/Armour/Concord type dependency in UI.
- **Acceptance:** identical input produces identical glyph; fallback/palette tests
  pass; generated declarations and runtime import graph have no domain package
  coupling. Application code can pass canonical identity display data without a
  second UI implementation of cryptographic validation.

### B10 — Complete UI assets and observable behavior

- **Evidence:** current design-system/theme/style sources and generation/check
  scripts; retained primitive/pattern tests/specs; source glyph/interaction cases.
- **Targets:** `packages/ui/src/{style.css,design-system,themes}/`, exports,
  CSS side-effects policy, generation scripts and focused behavior/consumer tests.
  **Depends on:** B08–B09.
- **Scope:** deliberate CSS/theme exports and publication allowlist, deterministic
  clean generation and Tailwind integration through the actual UI profile. Keep
  existing target styling. Test meaningful labels, state updates, disabled controls,
  focus/keyboard/overlay interactions for retained surfaces; no redesign/new app.
- **Acceptance:** every exported asset exists in tarball; clean generation repeats
  identically; a production consumer importing one component and explicit CSS has
  correct computed styling after tree shaking and theme switching, without scanning
  this checkout. Real interactions pass; source-text assertions alone do not count.

### B11 — Expand package policy and the complete verification graph

Partial, 2026-11-20: Seal now participates in workspace format/lint/types/behaviour/
build/packed-consumer gates and is removed from the legacy-excluded list. UI
activation and complete six-product validation remain pending.

- **Evidence:** root scripts/workspace/tsconfig, `scripts/verify/{contract,check,workspace}.mjs`,
  tooling config/validator/tests, UI diagnostic and current CI.
- **Targets:** those files plus `.github/workflows/ci.yml` and focused broken
  package fixtures. **Depends on:** inventory review; land alongside package activation.
- **Scope:** explicitly classify six public products and private consumers; no
  silent package omissions. Extend existing checks for Vue peers/CSS/types,
  declared dependencies/exports and publication contents. Preserve Oxfmt/Oxlint,
  authoritative TS/Vue checks and useful nonzero failures. Keep legacy exclusions
  explicit; do not include old workspaces merely by changing globs.
- **Acceptance:** Seal/UI participate in separate format/lint/types/behavior/build/
  consumer gates as activated; intentionally broken export/bin/type/CSS/peer or
  undeclared sibling fails. Existing fixture tests still establish portable
  profiles; fresh clone/frozen install requires no ignored generated input.

### B12 — Prove the storage boundary and conflict behavior

Implemented locally, 2026-11-20: minimal adapter types, an in-memory atomic
expected-head reference, conflict bytes, retained forks/drafts, reopen and anchor
checks. Runtime remains independent of storage. See [storage proof and verification](storage-boundary-2026-11-20.md).
Atomicity is limited to writers sharing the reference instance; no production
provider or cross-process update adapter is claimed.

- **Evidence:** legacy storage sources above; `src/testing/index.ts` memory store,
  current snapshot comparison/anchor contracts; handshake storage handling.
- **Targets:** Concord testing/consumer fixtures and boundary documentation; only
  a small adapter contract/helper if a concrete fixture requires it.
  **Depends on:** B04–B05.
- **Scope:** external read/write and optional expected-head publication, independent
  of command commit. Keep both divergent snapshots; no automatic head selection.
- **Acceptance:** export/write/reopen reproduces saved state; failed I/O retains
  local snapshot/draft; stale expected head rejects overwrite; two valid forks are
  surfaced with both artifacts retained. Anchored rollback detection and unanchored
  limitations remain explicit. No publication side effect in dispatch.

### B13 — Verify the complete packed candidate set

- **Evidence:** `scripts/verify/consumers.mjs`, text consumer fixtures, current
  exact-tarball override proof; release contract section 3.
- **Targets:** existing harness or release consumer module and private fixtures.
  **Depends on:** B02–B12.
- **Scope:** build topologically, pack each public candidate once; serve final
  names/versions from an isolated candidate registry so actual rewritten sibling
  ranges resolve without file overrides. Reuse the working Node 22/24, browser,
  declaration, protocol-isolation, standalone tooling and CLI checks; add Seal/UI.
- **Acceptance:** all six exact candidate digests exercised outside workspace;
  a deliberately wrong sibling range fails rather than resolving a predecessor.
  All declared imports/assets/types/bin resolve. Browser crypto and production UI
  CSS/interaction checks pass. Preserve immutable tarballs and gate evidence.

### B14 — Implement release planning and retryable artifact publication

- **Evidence:** release contract; `.changeset/config.json`, `.ops/publish.mjs`,
  legacy release/tag workflows; no target scripts currently installed.
- **Targets:** `.github/scripts/{plan-release,publish-release}.mjs`, focused
  automation tests, Changesets dependency/config/prerelease state and release docs.
  **Depends on:** B11 for scaffolding; B13 for final artifact integration.
- **Scope:** use Changesets version intent, public access and alpha `next`; discover
  eligible manifests; plan dependency order; record source/lock/toolchain/gate and
  exact SHA-256/SRI. Publish retained bytes, journal attempts, compare existing
  registry integrity, bounded propagation retry and delayed channel promotion.
  No commit-message version selection, shell interpolation or repack on publish.
- **Acceptance:** saved-response/argv tests prove no-op, missing plan/private
  exclusion, tampered/missing artifact, same-integrity retry, version collision,
  partial dependency publication and interrupted tag promotion. No `latest`
  change during alpha release; failures cannot mark complete success.

### B15 — Install one CI/release workflow chain and setup instructions

- **Evidence:** `.github/workflows/{ci,release-create,release-publish,deploy-*}.yml`
  and release contract. **Targets:** shared setup action, `release-pr.yml`,
  `publish.yml`, CI artifact handoff and `docs/engineering/deployment-setup.md`.
  **Depends on:** B14 and B13 before cutover.
- **Scope:** exact pins/frozen setup, same-SHA eligible artifacts, least privilege,
  serialized retryable publisher, retained receipts/digests. Replace competing
  old release/tag publishers together; exclude Utils/Workspace. Document GitHub
  App/event behavior and exact npm trusted-publisher identity. No hosted app deploy.
- **Acceptance:** validation/dry-run fixtures prove trigger/plan selection and
  private exclusions; one active npm publication path remains. Remote checks and
  test-channel OIDC proof are separately recorded before calling delivery verified.
  Inspect current official registry/GitHub policy at implementation time rather
  than assuming the older contract's external-version facts remain current.

### B16 — Complete registry onboarding and published consumption proof

- **Evidence:** verified B13 candidates/B14 plan/B15 workflow and setup guide.
- **Targets:** npm/GitHub package trust settings and release receipts; a clean
  external consumer and dated shipping evidence. **Depends on:** B13–B15 and real
  account/release inputs. No account settings have been verified by this inventory.
- **Scope:** read current versions/dist-tags before allocating release versions;
  establish trust for actual names/workflow/environment, exercise a test package
  first, then use the authorized release process. Install published exact versions
  in a clean external project; no workspace access or candidate overrides.
- **Acceptance:** registry integrity matches each retained tarball; fresh consumers
  exercise Identity, Armour, Concord lifecycle/group/draft behavior, Seal CLI/library,
  UI assets/types and portable tooling. Record exact versions, source/release IDs,
  receipts and any incomplete channel state. Never infer publication from a build.

## Dependency order and review points

Start B01/B02 and B11. Once the group contract is settled, Concord follows
B03 → B04 → B05 → B12. Seal follows B06 → B07; UI follows B08 → B09 → B10.
These paths converge at B13. Release tooling B14 can develop against saved
responses while packages migrate; real workflow cutover B15 and publication B16
follow complete candidate verification.

The material review is B01's concrete schema/authority/readable-view contract,
B02's lean but useful helper surface, and the UI export/asset choices in B08/B10.
Do not reopen accepted choices such as writer-created groups, full historical
admission, owner access only by grant, explicit locked markers, system-first replay
or no divergence merge. Keep v1 omissions above explicit; they are how the migration
stays within six products rather than becoming a port of every historical app.

No new tracker tasks, external messages, implementation commits, remote workflow runs,
account changes, npm publication or deployment were performed by this inventory.

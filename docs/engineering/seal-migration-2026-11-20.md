# Seal library and CLI migration

B06/B07 implementation and Seal's B11 gate activation, 2026-11-20. Seal is now an active
`@ternent/seal` workspace product using the shared toolchain and actual local public
Identity/Armour outputs. Local candidate is `0.5.0-alpha.0`; no registry allocation,
publication or dist-tag change is performed here.

## Delivered library contract

The existing proof, encrypted-artifact, manifest and identity conveniences are retained.
Wire proof/public-key version remains `2`, manifest/artifact remains `1`. The inaccurate
`SealProofV1` type is replaced by `SealProofV2`, without an unused alias. The root and
`/proof`, `/artifact`, `/manifest`, `/crypto`, `/errors` exports have declarations.
The executable is separate from those browser-safe graphs.

Seal now owns a narrow internal canonical JSON/hash helper in `src/json.ts`, replacing
the undeclared `ternent-utils` import and removing the Utils dependency. It preserves
ordinary schema bytes and native integer-key ordering. It rejects ambiguous/non-JSON
host values, custom prototypes, serialization hooks, accessors, cycles, invalid Unicode
and excessive depth. Prototype-like filename keys are safely retained, correcting
previously dropped entries. No Concord import, hash domain or runtime is reused.
[The format contract](../seal/format.md) defines values and exact signed bytes.

Identity still owns derivation, signing, key-ID binding and strict point/signature
verification. Proofs sign the same `ternent-seal/v2` context plus NUL and canonical
payload; no cryptographic primitive is reimplemented. Signer resolution now validates
that the private seed, public key and key ID agree. Malformed keys/signatures return
failed verification. Source operations capture mutable caller inputs before awaits;
validators and public field helpers reject getters without invoking them.

Armour still owns age encryption/decryption through typage (`age-encryption`), with no
WASM/init lifecycle. Artifact checks bind manifest metadata, unsigned container and
ciphertext before decryption. Existing recipient-targeted behaviour and wrong-recipient
failures are retained. Public signer/path/timestamp/metadata/headers/sizes are explicit;
no metadata-hiding or recipient-delivery guarantee is added.

## CLI and activation

Seal uses the shared `node-cli` profile, ESM/ES2022 build and pinned TypeScript/Vite+.
Absent sibling-source/Rage aliases and the old Vite build config are removed. The
existing executable wrapper remains, with an explicit `./bin/seal` manifest path,
Node shebang and executable mode. Library imports do not execute the CLI. The wrapper
and CLI entry handle promises explicitly.

Commands retain identity/mnemonic creation, deterministic manifest enumeration,
file/manifest signing, recipient-mode artifact signing, offline verification and
public-key output. Added help succeeds without signer configuration. Argument parsing
preserves equals signs inside inline values and avoids prototype-backed flag storage.
Identity and mnemonic files use mode `0600` before secret content is written. Invalid
identity files/seeds are configuration errors with sanitized output. Malformed proof/
artifact JSON/schema returns exit 4 consistently; all exit codes 0–5 are checked.

Workspace discovery, lockfile importer, root format/lint/types/behaviour/build checks,
package policy and isolated consumers now include Seal. The lockfile change from the
previous checkpoint is its new importer, with no unrelated dependency upgrade. UI
remains intentionally inactive until its own migration; full B11/release work is not
claimed complete.

The inspected standalone Action accepts package/version and CLI overrides. The packed
fixture runs its manifest-create → sign → public-key sequence on a clean build directory,
then independently verifies the emitted proof/public-key agreement and raw manifest
bytes. It executes the installed candidate bin, not repository source. No Action
repository edit, hosted Action run or registry-backed execution is claimed.

## Evidence and verification

[vectors/proof.v2.json](../seal/vectors/proof.v2.json) fixes a public RFC seed identity,
subject/key hashes, canonical signing payload, domain-prefixed message and Ed25519
signature generated independently with Node crypto. A fixed manifest covers Unicode,
integer filenames and `__proto__`. Source and installed consumers compare those
literal bytes/signatures. They do not derive expected output from Seal's implementation.

All five existing test suites are retained and migrated to Vite+. New cases cover
signed-field mutations, malformed encodings, seed/public-key mismatch, canonical-input
boundaries, hostile getters, prototype filenames, artifact tampering, unauthorized
decryption, help and async input snapshots. Read-only review caught custom array
prototype acceptance and direct public signing-payload getter execution; both have
focused regressions and are corrected.

Packed consumers exercise every public export, declarations, encrypted round trips,
CLI file modes/help/exit codes and the Action's command sequence on Node 22/24.
A resolution-hook check blocks Node builtins, Concord, Utils and Rage while importing
all library exports and verifying the fixed proof. The browser consumer bundles fixed
proof verification and artifact encrypt/verify/decrypt through installed candidates.

Verification used pinned Node 24.21.0 / pnpm 10.33.4:

| Check                                                  | Result                                                                                                     |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| Root behaviour suite                                   | 199 tests passed in 22 files, including 34 Seal tests                                                      |
| Built handshake CLI/MCP smoke                          | 2 tests passed                                                                                             |
| Contract, format, build and typed lint                 | Passed with Seal active                                                                                    |
| Tooling, root, fixture and product TS/Vue scopes       | Passed, including Seal declarations                                                                        |
| Installed Node 22.18.0 / 24.21.0                       | All Seal public paths, fixed proof, encrypted artifact, executable, Action sequence and exit checks passed |
| Library dependency isolation                           | Every library export imported and fixed proof verified with Node builtins/Concord/Utils/Rage blocked       |
| Installed declaration checks                           | Passed, including deliberate Seal input/version failures                                                   |
| External library and production Vue/Seal browser build | Passed                                                                                                     |
| Chromium execution                                     | Blocked at launch by macOS Mach port permission denial                                                     |

The root gate run passes its first ten gates and exits nonzero only in consumers at
Chromium launch (`bootstrap_check_in ... Permission denied (1100)`). Browser assertions
and portable feedback checks placed after that step were not reached. The browser
fixture builds; actual browser verification/encryption execution is not claimed.
No assertions or gates were bypassed.

The exercised Seal tarball SHA-256 was
`181128f17daf49b41dcff26503e7ee979e88550409e518b1dec0c4232f29177e`.
Machine-local evidence is in `artifacts/pilot-check.json` and
`artifacts/pilot-consumers.json`; these are not registry/release receipts. The earlier
GitHub checkpoint does not certify this newer slice. No new remote CI result,
npm publication, deployment or measured performance gain is claimed.

## Remaining work

UI activation and presentation-only identity glyphs/assets are next (B08–B10), followed
by complete product policy/candidate verification and release planning/publishing
(B11, B13–B16). Current packed consumers still use explicit candidate sibling overrides;
they do not establish final registry-range resolution. The independent Action's defaults
remain a separate integration setting to select when actual versions are published.

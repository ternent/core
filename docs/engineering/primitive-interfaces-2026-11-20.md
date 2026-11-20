# Identity and Armour shipping interfaces

B02 implementation note, 2026-11-20. The
[shipping inventory](shipping-inventory-2026-11-20.md) defines the release scope.
This is a focused public-interface change, not completion of the whole stack.

## Consumer evidence and resulting surface

Inspected the source Identity/Armour implementations and retained tests, the target
public exports/types, Concord's capability use and Seal's
`src/{crypto,artifact}.ts`. Seal still needs mnemonic creation/restoration,
serialized identity persistence, raw key IDs and contextual signing, plus Armour's
recipient encryption and serialized-identity decryption. These are useful host
operations rather than reasons to retain an initialization lifecycle.

| Area                         | Result                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity public exports      | Explicit named capability and host-helper exports replace wildcard publication. Existing intentional functions/types remain available.                                                                                          |
| Signing                      | Capability `sign` signs exact bytes. `signBytes`/`signUtf8` prefix context and a zero byte; their default remains `ternent-seal/v2`, matching Seal. Neither convenience verifier replaces strict Concord protocol verification. |
| Host identity representation | Seed/mnemonic/serialization helpers remain. Docs distinguish seed-bearing `SerializedIdentity` from `PublicIdentity`, and shape parsing from seed/key consistency validation.                                                   |
| Armour setup                 | Removed `initArmour`, its init-only source/error/code, and the module-global initialized flag. Every retained helper works immediately after import.                                                                            |
| Armour redundant export      | Removed `assertIdentityCapabilityRoot`; it duplicated identity parsing/algorithm checks and had no inspected consumer. Existing `resolveIdentity` remains.                                                                      |
| Armour crypto and formats    | Same TypeScript age engine, selected APIs, output defaults and remaining structured errors. No primitive, key derivation or signature construction changed.                                                                     |
| Seal integration             | Removed its import and two calls to the deleted initializer. Full Seal integration remains B06/B07; its old Utils imports/build wiring are not repaired by this change.                                                         |
| Documentation                | Corrected synchronous `withAgeDecryption` composition vs result-returning async factories; listed intentional convenience operations and failure/output behavior.                                                               |

The obsolete initialized/not-initialized behavior tests were replaced by an
immediate-import encryption/decryption regression. All other helper behavior tests
remain, now called without initialization. The focused suite reports 29 tests;
the previous full 119-test count decreased by one because two init-only tests
became one observable roundtrip test, not because a failure assertion was weakened.

## Package-consumer coverage

`scripts/pilot/primitives-consumer.txt` is installed into the isolated tarball
consumer and run on both supported Node lanes. It exercises mnemonic restoration,
serialization/validation, raw/contextual signing separation, recipient derivation,
armored and binary encryption/decryption without setup, capability composition and
an unauthorized recipient failure. This uses real public package imports, not
sibling source aliases.

`primitives-types.txt` checks public declarations, capability composition and
intentional compile-time errors for treating public identity as a signer,
exporting a capability as a private seed document, or passing text to byte signing.
The browser consumer also includes an init-free convenience roundtrip. Building
that browser bundle does not establish that it executed in a browser.

The existing harness still pins sibling candidates through tarball overrides;
testing final sibling ranges without overrides remains B13. Seal itself remains
outside the active workspace, so testing these primitives is not a passing Seal
package/CLI result.

## Verification

Development runtime: Node 24.21.0, pnpm 10.33.4. Commands use the installed pinned
Node explicitly in this shell.

- `pnpm exec vp run --filter @ternent/armour --fail-if-no-match build-ready`:
  passed fresh Identity and Armour builds, including declaration output.
- `pnpm exec vp test run packages/identity/test packages/armour/test`:
  passed 29 tests in four files, including independent signature/conversion fixtures,
  secret-callback cleanup, malformed identities/signatures, wrong recipient/passphrase
  behavior, saved age ciphertext and both directions of native-age interoperability.
- `pnpm check`: first ten gates passed (contract, formatting, graph build, lint,
  tooling/root/fixture/product type checks, behavior and handshake artifact checks).
  Behavior passed **118 tests across 14 files**; built CLI/MCP smoke passed **2 tests**.
- Packed consumers: exact candidate installation, primitive/Concord public imports,
  mnemonic/signing/encryption behavior on **Node 22.18.0 and 24.21.0**, protocol
  import isolation, public declarations/intentional TypeScript failures and external
  library/Vue production builds passed.
- Overall `pnpm check` exited **1** at the browser consumer gate: Chromium could
  not launch because macOS sandbox denied Mach-port registration
  (`bootstrap_check_in ... Permission denied (1100)`). This reproduces the earlier
  environment restriction. The new browser helper assertion did not execute, and
  consumer checks after browser launch were not reached. No gate was disabled and
  no assertion weakened to obtain a passing result.

No new behavior assertion, build, lint or type failure was observed. Browser execution
remains unverified. Full Seal/UI migration, whole-release candidate-range proof,
remote CI, registry versions/trust, publication and deployment remain outstanding.

Console logs for this pass are `/tmp/ternent-b02-build.log`,
`/tmp/ternent-b02-tests.log`, and `/tmp/ternent-b02-check.log`. Current structured
reports are generated under `artifacts/pilot-{check,consumers}.json`.

## Next implementation

The independent-membership decision and one-audience-per-command rule are accepted
in [ADR 0015](../adr/0015-keep-audience-memberships-independent.md) and
[ADR 0016](../adr/0016-route-each-command-to-one-audience.md). Implement group
authoring/system replay and explicit readable coverage in B03/B04 using the
[design draft](../concord/group-profile-design.md). These primitive changes do not
implement groups, scoped projections or drafts.

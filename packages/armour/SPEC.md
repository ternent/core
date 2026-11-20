# Armour interface contract

The current interfaces and compatibility guarantees are in [README.md](README.md).
The alpha capability and binary operations implement the primitive contract in
[the Concord blueprint](../../docs/concord/implementation-blueprint.md#4-identity-and-primitive-package-interfaces).

The intentionally retained text/binary/recipient/passphrase helpers, error codes and
output defaults are described in README.md and exercised by behavior/consumer tests.
Every operation is init-free. The old initialization API/error and redundant
`assertIdentityCapabilityRoot` helper are not part of the shipping surface.
The historical specification in [legacy/SPEC.md](legacy/SPEC.md) is source evidence,
not a compatibility requirement. Rage/WASM is not a runtime dependency, and Armour
adds neither document semantics nor a second encryption construction.

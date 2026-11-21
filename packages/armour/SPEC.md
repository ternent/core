# Armour interface contract

The current interfaces and compatibility guarantees are in [README.md](README.md).
The published declarations define the capability and binary operations. Armour
remains independently usable; its optional payload codec composes structurally
with Ledger without a package dependency in either direction.

The intentionally retained text/binary/recipient/passphrase helpers, error codes and
output defaults are described in README.md and exercised by behavior/consumer tests.
Every operation is init-free. The old initialization API/error and redundant
`assertIdentityCapabilityRoot` helper are not part of the shipping surface.
Historical specifications remain source evidence in Git, not compatibility
requirements. Rage/WASM is not a runtime dependency, and Armour
adds neither document semantics nor a second encryption construction.

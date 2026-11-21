# Seal architecture

`@ternent/seal` supplies browser-safe proof/artifact/manifest/crypto/error APIs and a
separate Node executable. Preserve wire proof/public-key version 2 and manifest/artifact
version 1. Seal owns its canonical signing subjects; Identity owns signing, strict
verification and identity derivation; Armour/typage owns encryption. No Concord, Utils,
Rage, source aliases or cryptographic reimplementations belong here. Read docs/seal/format.md
and the dated migration evidence before changing signatures or accepted canonical values.

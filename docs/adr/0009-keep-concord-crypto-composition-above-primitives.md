---
status: accepted
---

# Compose document crypto above independent primitives

Identity owns strict raw-byte signing and deterministic key conversion; Armour owns the
pure TypeScript age engine and composes decryption capabilities with Identity. Concord
owns canonical signed document subjects and its standard system profile; Seal remains
an independent artifact-proof consumer. Protocol verification has no runtime, model,
Armour, or Seal dependency. This avoids a primitive-package cycle and prevents legacy
Identity signature context or Seal proof semantics from silently changing Concord's
wire bytes. Candidate tarball consumers must prove those separations. See
[module ownership](../concord/implementation-blueprint.md#5-modules-and-packages).

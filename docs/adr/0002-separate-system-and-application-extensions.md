---
status: accepted
---

# Separate system and application extensions

Concord recognizes system extensions and application models as its two execution
classes. Host-trusted system extensions establish identity, authority, privacy, and
decryption before a typed application model sees domain events; application code never
handles raw keys or mutable permission state. This preserves the proven two-pass design
without exposing the legacy mutable replay context or requiring applications to rebuild
security lifecycle code.

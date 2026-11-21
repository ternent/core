---
status: accepted
---

# Use one derived identity suite

Alpha fixes one versioned suite: an Ed25519 identity signs, and deterministic conversion
of the same key material supplies its X25519 age capability. Public identity data and
private host capability are separate API types, while conversion rules and vectors are
normative for interoperability. This retains one simple identity for developers and
removes the need to store or bind a second encryption key.

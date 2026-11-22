---
status: accepted
---

# Sign canonical commit subjects with explicit domains

Use restricted RFC 8785 JSON, safe integers, canonical binary encodings, and separate
entry/commit/signature domain prefixes. A commit signs the complete unsigned subject,
including declarations at genesis, signer, parent, ordered entry IDs, nonce, and signed
metadata. Entry hashes are authenticated by their commit, so independent entry proofs
and Seal's artifact envelope are unnecessary. This chooses a small language-neutral
document contract over legacy proof reuse; permissive parsing or changing canonical
values later would change identifiers and interoperability. See the exact byte rules
and fixed artifacts in [Protocol 1](../concord/alpha-protocol.md).

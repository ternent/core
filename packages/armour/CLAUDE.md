# Armour architecture

Armour composes Identity with the pinned TypeScript age engine. Keep encryption,
decryption and compatibility helpers here. Identity owns signing primitives; Ledger
owns signed history; Concord owns framework authority and encryption orchestration.
Keep the optional payload codec structurally compatible with Ledger without adding
a package dependency in either direction. Read the current README before extending
the interface. Historical implementations are available in Git.

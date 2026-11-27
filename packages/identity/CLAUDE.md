# Working on Identity

Identity is one file, `src/index.ts`: six functions that produce or check one
`Identity`. Ledger, Seal and Armour take that object directly. Keep it that small.

## What Identity owns

- Key creation, the `ternent-identity` version 2 backup, BIP-39 recovery at SLIP-0010
  path `m/101010'/25519'/0'`, exact-byte signing and strict verification.
- The `PublicIdentity` shape and its `id` binding.
- Not protocol messages. Seal and Ledger build their own domain-separated bytes and
  call `sign` on them. Not age encoding either: Armour derives recipients itself.

## How the code stays small

- Use Noble and Scure for every primitive and encoding. Don't write a Base64, hex or
  Bech32 routine, and don't wrap a library call that already fails clearly.
- Noble's `zip215: false` verification rejects non-canonical encodings, `S` outside
  the group order and small-order keys. The code adds only what Noble doesn't do:
  rejecting mixed-order keys and small- or mixed-order `R`.
- Validate where data enters (`restoreIdentity`, `validatePublicIdentity`, `verify`),
  then trust the values you built. Seeds produced inside the package aren't re-checked.
- The private seed leaves only through `export()`. `withX25519Secret` lends a derived
  secret and zeroes it when the callback settles, including on failure.
- `sign` runs before its first `await`, which captures the caller's bytes.

## Checks

Run `pnpm run check` in this package under the Node version in `.node-version`.
`test/vectors.json` holds existing backups, signatures and derivations; changing a
result there breaks every stored identity. Update `README.md` and `llms.txt` with any
interface change.

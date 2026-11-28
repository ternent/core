# Working on Armour

Armour is two functions in `src/index.ts` that choose age keys and call one age
`Encrypter` or `Decrypter`. Keep it that small.

## What Armour owns

- Turning a `PublicIdentity` into an age X25519 recipient (Noble's Ed25519 to
  X25519 conversion, Scure's Bech32) and an `Identity` into a decryption key through
  `withX25519Secret`.
- Which key forms are accepted: identities, native X25519 strings and a nonempty
  passphrase. Nothing else.
- Not the cryptography. age does the encryption, authentication, armor and scrypt
  limits. Not groups or key distribution: Concord owns those. Not signing: Seal.

## How the code stays small

- Let age's errors through. No error classes, codes or result wrappers.
- Copy input bytes before the first `await`: age reads them later. Read recipients
  and passphrases synchronously for the same reason.
- The seed never enters Armour. Only the scoped X25519 secret does, and the Bech32
  words built from it are cleared. A JavaScript string holding a secret key can't be
  erased, and that is accepted.
- No text, file, codec or streaming variants. Callers own transport and size limits.

## Checks

Run `pnpm run check` in this package under the Node version in `.node-version`. The
tests need the native `age` CLI on `PATH` for the interop check. `test/vectors.json`
holds ciphertext made by native age for a personal and a group key; it must keep
decrypting. Update `README.md` and `llms.txt` with any interface change.

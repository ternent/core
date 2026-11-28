# @ternent/armour

[Agent interface guide](llms.txt): public imports, examples and contracts.

Encrypt and decrypt bytes with [age](https://age-encryption.org). Identity supplies
personal keys; groups use native age keys; backups use a passphrase.

```ts
import { encrypt, decrypt } from "@ternent/armour";

const ciphertext = await encrypt(bytes, [alice.publicIdentity, bob.publicIdentity]);
const plaintext = await decrypt(ciphertext, bob);
```

| Use             | Encrypt with                         | Decrypt with                           |
| --------------- | ------------------------------------ | -------------------------------------- |
| People          | Their `PublicIdentity` records       | The recipient's `Identity`             |
| A group         | The group's `age1…` X25519 recipient | The group's `AGE-SECRET-KEY-1…` string |
| Identity backup | `{ passphrase }`                     | `{ passphrase }`                       |

Identities and group recipients can share one recipient array. Every call uses fresh
randomness. Output is binary age, readable by the `age` CLI and any age library.
Empty plaintext is valid.

Invalid input, a wrong key or passphrase, and tampered ciphertext all reject with an
ordinary `Error`. Plaintext is returned only after age authenticates it. Inputs are
copied when the call starts.

Armour works in memory: bound the size of incoming ciphertext before decrypting.
Passphrase files use scrypt; age rejects a work factor above 2^20 (about 1 GiB of
memory) before deriving a key. Scrypt runs synchronously, so unlock a backup off the
browser's main thread.

Text transport, file reads and storage belong to the caller. For ASCII armor, use
`armor.encode` and `armor.decode` from `age-encryption`. To sign ciphertext, seal its
exact bytes with `@ternent/seal`.

License: ISC.

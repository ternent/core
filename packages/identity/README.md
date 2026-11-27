# @ternent/identity

[Agent interface guide](llms.txt): public imports, examples and contracts.

One Ed25519 identity for the Ternent libraries. Create or restore it once and pass it
to Ledger, Seal and Armour; no consumer handles the seed.

```ts
import { createIdentity, restoreIdentity, verify } from "@ternent/identity";

const identity = await createIdentity();
const backup = identity.export(); // private: contains the seed
const restored = await restoreIdentity(backup);

const signature = await identity.sign(bytes);
await verify(identity.publicIdentity, bytes, signature); // true
```

Recovery words are opt-in:

```ts
const { identity, mnemonic } = await createMnemonicIdentity({ words: 24, passphrase });
const same = await recoverIdentity(mnemonic, passphrase);
```

| Export                                          | Purpose                                                    |
| ----------------------------------------------- | ---------------------------------------------------------- |
| `createIdentity()`                              | New identity from a random seed                            |
| `restoreIdentity(backup)`                       | Identity from `export()` JSON; rejects mismatched fields   |
| `createMnemonicIdentity({ words, passphrase })` | New identity and its 12- or 24-word BIP-39 phrase          |
| `recoverIdentity(mnemonic, passphrase?)`        | Same identity from the same words and passphrase           |
| `verify(publicIdentity, bytes, signature)`      | Strict Ed25519 verification; `false` for any invalid input |
| `validatePublicIdentity(input)`                 | Frozen `PublicIdentity` from untrusted input, or throws    |

A `PublicIdentity` is `{ version: 1, algorithm: "Ed25519", publicKey, id }`, with a
base64url key and `id` = `identity:` + hex SHA-256 of the key. It is safe to store in
documents.

An `Identity` has `publicIdentity`, `export()`, `sign(bytes)` and
`withX25519Secret(use)`. `sign` signs exactly the bytes given; protocols add their
own domain separation. The X25519 secret lent to `use` is zeroed when the callback
settles, so keep no copy.

The backup is `ternent-identity` version `"2"` JSON. Encrypting and storing it is
the application's job, using Armour when needed. Recovery words derive the seed at
SLIP-0010 path `m/101010'/25519'/0'`; a different passphrase gives a different
identity.

Verification rejects non-canonical encodings, small-order and mixed-order keys and
`R` values, and `S` outside the group order.

License: ISC.

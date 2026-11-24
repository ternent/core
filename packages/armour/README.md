# @ternent/armour

[Agent interface guide](llms.txt): public imports, examples and lifecycle contracts.

Identity-aware age encryption, backed by the pinned pure TypeScript `age-encryption`
engine. No runtime WASM initialization or command-line process is required.

```ts
import { generateIdentity, encryptAge } from "@ternent/armour";
const created = await generateIdentity();
if (!created.ok) throw new Error(created.error.code);
const identity = created.value; // public identity, exact-byte sign, decryptAge
```

`identityFromSeed(seed)` copies the private root through Identity's signer factory.
`withAgeDecryption(base)` synchronously composes an existing base signer without
moving private identity ownership into Armour. `identityFromSeed` and
`generateIdentity` return structured primitive results; `withAgeDecryption` returns
the composed capability directly.
`encryptAge({ recipients, plaintext })` accepts X25519 recipients and returns binary age.
`decryptAgeWithSecret({ secret, ciphertext })` accepts a raw 32-byte X25519 scalar.
These operations have no init step and support an empty plaintext.

All operations work immediately after import. There is no `initArmour` API or
global initialization state. Text, recipient, passphrase and binary conveniences
use the same TypeScript engine as the capability interface.

| Input/output need                                     | Public helpers                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Serialized identities or age recipients, byte payload | `encryptForIdentities`, `encryptForRecipients`, `decryptWithIdentity`, `decryptWithSecretKey`                           |
| Passphrase, byte payload                              | `encryptWithPassphrase`, `decryptWithPassphrase`                                                                        |
| UTF-8 text                                            | `encryptTextForIdentities`, `decryptTextWithIdentity`, `encryptTextWithPassphrase`, `decryptTextWithPassphrase`         |
| Blob/File/ArrayBuffer/Uint8Array                      | `encryptBinaryForIdentities`, `decryptBinaryWithIdentity`, `encryptBinaryWithPassphrase`, `decryptBinaryWithPassphrase` |
| Host identity resolution and recipient derivation     | `resolveIdentity`, `recipientFromIdentity`, `secretKeyFromIdentity`, `recipientsFromIdentities`                         |

Convenience encryption defaults to ASCII armor; byte/binary helpers accept
`output: "binary"` explicitly. Decryption accepts the supported binary/armor form
and returns bytes, except text helpers return UTF-8 strings. Convenience helpers
reject with `ArmourValidationError`, `ArmourIdentityError`, `ArmourEncryptionError`
or `ArmourDecryptionError`, all derived from `ArmourError` with a structured code.
They require nonempty payloads, with a 64 MiB engine limit; the low-level
`encryptAge` interface supports empty plaintext and returns `PrimitiveResult`.

```ts
import { createIdentity } from "@ternent/identity";
import { encryptTextForIdentities, decryptTextWithIdentity } from "@ternent/armour";
const identity = await createIdentity();
const encrypted = await encryptTextForIdentities({ identities: [identity], text: "hello" });
const text = await decryptTextWithIdentity({ identity, data: encrypted });
```

Historical implementations are available in Git.

## Optional payload integration

`createAgeCodec({ recipients?, reader? })` supplies an `id: "age"` byte codec for
composing Armour with Ledger's `encodePayload`/`decodePayload` helpers. Armour does
not import Ledger. Supplying recipients enables encoding; supplying a `decryptAge`
reader capability enables decoding. Recipients are copied when the codec is created.
An absent operation remains absent; it never falls back to plaintext.
The factory preserves these capabilities in its return type: recipients guarantee
`encode`, a reader guarantees `decode`, and supplying both guarantees both methods.
No non-null assertions are needed. Dynamically optional configuration returns the
general codec type and does not promise either operation.

The codec uses the existing binary age operations. Its decoder returns `null` when
the reader reports an authentication/decryption failure, covering both wrong keys
and malformed ciphertext. Other reader failures reject; implementation exceptions propagate. The caller
owns entry creation, signed history and interpretation of readable/locked results.
See the [Ledger composition example](../ledger/README.md#optional-payload-codecs).

Armour owns neither signing semantics, document envelopes, authorization nor storage.
Identity owns key derivation. Ledger owns signed history; Concord composes it with
its private system profile.
Native age interop and the fixed independent ciphertexts are required tests.

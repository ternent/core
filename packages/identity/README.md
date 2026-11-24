# @ternent/identity

[Agent interface guide](llms.txt): public imports, examples and lifecycle contracts.

The alpha capability interface builds on the existing Ed25519/X25519 derivation code.
`signerFromSeed(seed)` and `generateSigner()` return structured results containing a
`BaseIdentityCapability`: public identity, exact-byte signing, and scoped
`withX25519Secret(callback)`. The copied scalar is zeroed after callback settlement,
including rejection. Callers must not retain secret copies from that trusted callback.
`validatePublicIdentity` and `verifySignature` enforce canonical prime-order points,
identity binding and strict signatures. Empty-message signing follows RFC 8032.

`ageRecipientFromPublicIdentity`, `ageRecipientFromSecret`, `ageSecretKey`, and
`validateAgeRecipient` own the key/Bech32 conversions; `encodeBase64Url` and
`decodeBase64Url` provide canonical byte encoding. The package does not implement age
files or depend on Armour, Concord, or Seal.

The root explicitly exports two useful interfaces: capabilities for protocol work
and seed/mnemonic/serialized helpers for host applications such as Seal. A
`SerializedIdentity` contains private seed material; `PublicIdentity` is the public
representation used in signed documents. Mnemonics and host identity exports are
outside the Concord wire format. No identity account or recovery service is implied.

| Purpose                                | Public functions                                                                                                                                                            |
| -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Host identity creation and persistence | `createIdentity`, `createIdentityFromMnemonic`, `createMnemonicIdentity`, `generateMnemonic`, `validateMnemonic`, `parseIdentity`, `serializeIdentity`, `validateIdentity`  |
| Raw key and age derivation             | `derivePublicKey`, `deriveKeyId`, `deriveX25519PrivateKey`, `deriveX25519PublicKey`, `convertEd25519PublicKeyToX25519PublicKey`, `deriveAgeRecipient`, `deriveAgeSecretKey` |
| Contextual signing                     | `signBytes`, `signUtf8`, `verifyBytes`, `verifyUtf8`, `getDefaultSignatureContext`                                                                                          |
| Mnemonic derivation details            | `getIdentityDerivationPath`                                                                                                                                                 |

`parseIdentity` checks and normalizes the serialized shape; `validateIdentity` also
checks that its seed, public key and key ID agree. Capability validation and
`verifySignature` use the strict point/signature rules described above. The
convenience verification helpers are not a substitute for protocol verification.

`signBytes`/`signUtf8` sign `UTF8(context) || 0x00 || payload` and return a base64url
signature. Their default context is `ternent-seal/v2`; pass an explicit context for
another protocol. `verifyBytes`/`verifyUtf8` must use the same context. Capability
`sign` signs exactly the supplied bytes and returns raw bytes inside a structured
result. Concord constructs its own signing message and uses that exact-byte path.

Historical implementations are available in Git. The distribution is ESM.

```ts
import { signerFromSeed } from "@ternent/identity";
const result = await signerFromSeed(seed); // copies the 32-byte seed
if (!result.ok) throw new Error(result.error.code);
const signature = await result.value.sign(new Uint8Array());
```

Host identity creation and persistence:

```ts
import { createMnemonicIdentity, serializeIdentity } from "@ternent/identity";
const { identity, mnemonic } = await createMnemonicIdentity({ words: 12 });
const exportedIdentity = serializeIdentity(identity);
// The host owns persistence of the private identity and recovery phrase.
```

Capability factories return `PrimitiveResult`; host helpers reject/throw on invalid
input. Import `PublicIdentity`, `BaseIdentityCapability`, `PrimitiveResult`,
`PrimitiveError`, `SerializedIdentity`, `IdentityMaterial` and `MnemonicWordCount`
from the package root when those types are needed.

Run `pnpm check` at the repository root for built-package, browser and consumer proof.
License: ISC.

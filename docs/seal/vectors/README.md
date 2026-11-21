# Seal fixed vectors

`proof.v2.json` uses the public RFC 8032 first Ed25519 test seed. It is test
material, never a private signing identity.

The fixture was generated independently with Node's `node:crypto` APIs. The seed
was encoded as PKCS#8 Ed25519, the public key extracted from SPKI, and the key ID
computed as lowercase SHA-256 of the raw 32-byte public key. The subject hash is
SHA-256 of `contentUtf8` encoded as UTF-8.

The proof payload recursively sorts object keys by UTF-16 code units and then
uses native `JSON.stringify`. Native ordering of integer-like property names is
therefore retained. The independent manifest example includes numeric names,
`__proto__` and supplementary-plane Unicode keys to fix those ordering details.

The signed message is UTF-8 `ternent-seal/v2`, one zero byte, then UTF-8
`signingPayload`. `messageHex` records those exact bytes. The signature is Node
Ed25519 over that message, encoded as unpadded base64url. Node verified the
signature before the fixture was saved. Behavior tests compare the library's
canonical payload, hash and signature against the saved values and separately
verify the saved signature with Node.

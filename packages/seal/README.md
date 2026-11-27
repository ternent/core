# @ternent/seal

[Agent interface guide](llms.txt): public imports, examples and contracts.

A detached Ed25519 proof over a content hash. Identity supplies the signer.

```ts
import { createSealHash, createSealProof, verifySealProof } from "@ternent/seal";

const proof = await createSealProof({
  signer: identity,
  subject: { hash: await createSealHash(bytes) },
});
const { valid, signatureValid, hashMatch } = await verifySealProof(proof, bytes);
```

`createSealHash(bytes)` returns `sha256:` and 64 lowercase hex digits (Web Crypto).
`createSealProof({ signer, subject, createdAt? })` signs with any object that has an
Identity's `publicIdentity` and `sign`, checks the returned signature, and returns the
proof. `verifySealProof(proof, bytes)` never throws: a malformed proof is invalid.
`valid` needs both the signature and the hash to match.

A valid proof says which key signed. Whether that key is trusted is the caller's
decision: compare `proof.signer` with the public identity you expect.

Seal anything as bytes. For a release, seal a manifest that lists the release and
each file's hash, then check the files against it. For encrypted data, seal the exact
ciphertext bytes you store, so the proof verifies before decryption. For armored
text, hash its UTF-8 bytes, line endings included.

## Format

```json
{
  "format": "seal",
  "version": 1,
  "createdAt": "2026-11-26T12:00:00.000Z",
  "subject": { "hash": "sha256:e3b0c442…b855" },
  "signer": { "version": 1, "algorithm": "Ed25519", "publicKey": "…", "id": "identity:…" },
  "signature": "…"
}
```

The signature covers `UTF8("ternent-seal/v1") || 0x00 || JSON` of every field except
`signature`, with object keys in UTF-16 order and no whitespace. Verification accepts
exactly these fields, a millisecond UTC `createdAt` and canonical unpadded base64url.
`createdAt` is the signer's claim, not evidence of time.

## CLI

```sh
SEAL_IDENTITY_FILE=identity.json seal sign --input release-manifest.json --out proof.json
seal verify --proof proof.json --input release-manifest.json
```

`sign` reads an Identity backup from `SEAL_IDENTITY_FILE` and prints the proof
unless `--out` is given. `verify` prints `{ valid, signatureValid, hashMatch }`.
Exit codes: 0 success, 1 error, 2 invalid proof.

License: ISC.

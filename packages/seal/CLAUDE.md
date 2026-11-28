# Working on Seal

Seal is three functions in `src/index.ts`. It runs in browsers and Node and has no
Node-only code. Keep it that small.

## What Seal owns

- The proof format and its signing message: `ternent-seal/v1`, a zero byte, then the
  unsigned proof as JSON with keys in UTF-16 order. `test/vectors.json` fixes those
  bytes. A change to them is a new format version, never an edit to the vectors.
- Nothing else. Identity owns keys, signing and strict verification. Trust in a signer
  is the caller's decision. Encryption, manifests and file sets belong to callers,
  who seal the bytes they produce.

## How the code stays small

- Validate untrusted input once, where it enters: `readProof` for proofs, Identity's
  `verify` for signatures. Don't re-check values that already passed.
- Use the dependencies' own checks. Noble's strict mode and Identity's validation
  already reject bad points, scalars and encodings; Scure's base64url rejects
  non-canonical text.
- Read every input field synchronously, before the first `await`, so a caller can't
  change it mid-operation. Pass the signer a copy of the message and check its
  signature against the original.
- `verifySealProof` never throws. It reports `signatureValid` and `hashMatch`
  separately, and the hash check stands even when the proof's signer is malformed.
- No error classes, result wrappers, subpath exports or option objects without a
  caller that needs them. A new export needs a consumer example first.

## Checks

Run `pnpm run check` in this package under the Node version in `.node-version`. Test
the observable contract: the fixed vectors, tampering with each signed field, malformed
proofs and call-time capture. Update `README.md` and `llms.txt` with any interface change.

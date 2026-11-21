# Seal format contract

Pre-release migration contract, 2026-11-20. Package candidate `@ternent/seal@0.5.0-alpha.0`
is distinct from wire versions. Existing proof/public-key v2, directory manifest v1
and encrypted artifact v1 formats remain selected. `SealProofV2` names the actual proof
version. No inaccurate V1 type alias, Utils dependency or Concord hash format is kept.

## Values and canonical bytes

Seal uses a narrow internal canonical JSON codec. Accepted values are null, booleans,
valid Unicode strings, safe integers except negative zero, dense normal arrays, and
plain objects (Object.prototype or null prototype). At most 64 object/array levels
are accepted. Functions, undefined, symbols, bigint, nonfinite/fractional/unsafe numbers,
accessors, hidden properties, custom prototypes, cycles and toJSON hooks are rejected.
No getters or serialization hooks execute. Validators and public signing-field helpers
copy canonical data before reading fields. Async operations capture caller-owned subjects,
identities, payload/recipient buffers and verification inputs before awaits.

Object keys are inserted in UTF-16 code-unit sort order into a null-prototype object,
then serialized with native JSON.stringify. ECMAScript integer-index enumeration
therefore places numeric filename keys in numeric order. This retains ordinary schema bytes and the previous
integer-key ordering. Prototype-like keys are now retained; this corrects dropped
entries and changes canonical bytes for affected manifests. There is no whitespace in canonical output and no Unicode
normalization. Manifests written by the CLI append one newline; file signing hashes
those raw bytes, including that newline. This is neither JCS nor Concord's numeric-
value/wire contract. SHA-256 is computed by Web Crypto over the exact supplied bytes.

## Proof and public key

A proof has exactly `version: "2"`, `type: "seal-proof"`, `algorithm: "Ed25519"`,
createdAt, subject, signer and signature. Subject has kind (`file`, `manifest`,
`artifact`), nonempty path and `sha256:` plus 64 lowercase hexadecimal digits.
Signer has raw canonical-base64url Ed25519 publicKey and a matching lowercase hex
SHA-256 keyId. Shape validation requires a parseable createdAt string; authoring
chooses an ISO timestamp unless one is supplied. That timestamp is a signed author
claim, not an independently trusted clock.

The canonical signing payload consists of all those fields except signature. The
signed message is `UTF8("ternent-seal/v2") || 0x00 || UTF8(payload)`. Identity's
contextual signing and strict raw-message verifier implement it. Signer resolution
validates the stored seed against its public key and key ID. Verification checks
canonical encodings and Identity's strict point/scalar/signature rules; malformed
keys/signatures produce failed verification rather than an escaping parser error.

A public-key artifact has exactly version `"2"`, type `"seal-public-key"`, algorithm,
publicKey and keyId. It conveys public material, not trust in that key. A host can pin
it or compare it against a proof signer. No profile/directory lookup is performed.

## Manifest and encrypted artifact

Directory manifests have exactly version `"1"`, type `"seal-manifest"`, nonempty root
and files mapping relative forward-slash paths to Seal hashes. Filesystem enumeration
is Node-only; parsing/stringifying remains browser-safe. CLI traversal skips `.DS_Store`
and symlinks/special entries, recursively hashes regular files and uses deterministic
code-unit ordering. It does not load files based on paths from an untrusted manifest.

Encrypted artifacts have exactly version `"1"`, type `"seal-artifact"`, manifest,
payload and proof. Artifact manifest version is `"1"`; both manifest and payload
identify encrypted age recipient mode and armored encoding. Manifest payloadHash hashes
the UTF-8 armored ciphertext bytes. Payload contains that armor string. The proof's
kind is artifact; its subject hash covers canonical version/type/manifest/payload,
excluding proof. Verification requires schema/metadata agreement, the signature, the
unsigned-container hash and payload hash. Only after success does decryption ask Armour
for the selected identity's plaintext. Unrelated identities fail decryption.

Age ciphertexts are randomized. Equal plaintext commands are not expected to emit
identical encrypted artifacts. Public proof signer/path/timestamp, metadata, age headers
and sizes remain visible. Recipient lists are not added as plaintext JSON fields;
this is no membership-hiding or guaranteed-delivery claim. No WASM initialization,
plaintext fallback, extra transport or new encryption scheme is introduced.

## Fixed evidence and executable boundary

[vectors/proof.v2.json](vectors/proof.v2.json) was independently constructed with
Node crypto: RFC 8032 public test seed, SHA-256 subjects/key ID, exact canonical payload,
context-prefixed message hex and Ed25519 signature. It also fixes Unicode/prototype/
numeric manifest-key encoding. The saved identity is public test material and must
never sign private data. Source and installed-package consumers compare literal
payload/hash/signature values and verify offline; they do not generate their expected
signature with Seal itself.

Only the separate executable imports Node filesystem/path/URL APIs. All six public
library exports have declarations and are checked with Node builtins, Concord, Utils
and Rage imports blocked. The browser fixture bundles proof/artifact operations from
the installed candidates. Its execution status is recorded separately in the
[migration evidence](../engineering/seal-migration-2026-11-20.md).

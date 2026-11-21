# @ternent/seal

Standalone file/manifest proofs and recipient-encrypted artifacts, with a browser-safe
library and the Node `seal` executable. Uses the public Identity and Armour APIs;
Armour's typage implementation needs no initialization or WASM step.

The local migration candidate is `0.5.0-alpha.0`. Registry publication is separate.
Proof/public-key wire version remains `2`; manifest/artifact wire version remains `1`.
The public proof type is `SealProofV2`.

## Library

```ts
import { createSealIdentity } from "@ternent/seal/crypto";
import { createSealHash, createSealProof, verifySealProofAgainstBytes } from "@ternent/seal/proof";

const identity = await createSealIdentity();
const bytes = new TextEncoder().encode("signed bytes");
const proof = await createSealProof({
  signer: { identity },
  subject: { kind: "file", path: "example.txt", hash: await createSealHash(bytes) },
});
const result = await verifySealProofAgainstBytes(proof, bytes);
```

Root re-exports the library. Typed subpaths are `/proof`, `/artifact`, `/manifest`,
`/crypto` and `/errors`. They import no Node filesystem/CLI code. The CLI is a separate
executable, with no import-time execution from public library paths. No Concord or
Utils dependency is required.

```ts
import { recipientFromIdentity } from "@ternent/armour";
import {
  createSealArtifact,
  verifySealArtifact,
  decryptSealArtifactPayload,
} from "@ternent/seal/artifact";

const recipient = await createSealIdentity();
const artifact = await createSealArtifact({
  signer: { identity },
  subjectPath: "example.txt",
  payload: bytes,
  recipients: [await recipientFromIdentity(recipient)],
});
const verification = await verifySealArtifact(artifact);
const plaintext = await decryptSealArtifactPayload({ artifact, identity: recipient });
```

Verification is offline. The proof binds the canonical unsigned proof fields with
Ed25519 over `UTF8("ternent-seal/v2") || 0x00 || UTF8(payload)`. Signer key ID is the
SHA-256 of its raw Ed25519 public key. Signing validates seed/public-key/key-ID binding;
verification uses Identity's strict point, encoding and signature checks. Valid signatures
identify a key; the caller decides whether that signer is trusted.

Artifact verification checks the signed unsigned-container hash and the armored
ciphertext hash before decryption. Payload bytes are encrypted; proof signer, subject
path, timestamp, container metadata, sizes and age headers remain public. Recipients
are not added as plaintext JSON fields; no traffic-pattern or metadata-hiding promise
is made. Verification does not prove other recipients can decrypt.

Canonical JSON accepts plain objects, normal arrays, valid Unicode strings, booleans,
null and safe integers, with a depth limit of 64. It rejects accessors, custom prototypes,
`toJSON` hooks, symbols, cycles, sparse arrays, undefined, bigint, nonfinite/fractional
numbers and negative zero. Object keys sort by UTF-16 code units before native JSON
serialization; native integer-index enumeration is retained from the prior Seal codec.
The format is Seal's own contract, not Concord canonicalization or a JCS claim.
See [the format and fixed evidence](../../docs/seal/format.md).

## CLI

Run the installed package's `seal` executable. This source candidate has not been
published by the migration.

```sh
seal --help
seal identity create --out identity.json --words 24 --mnemonic-out seal-backup.txt --quiet
export SEAL_IDENTITY_FILE=./identity.json
seal manifest create --input dist --out dist/dist-manifest.json --quiet
seal sign --input dist/dist-manifest.json --out dist/proof.json --quiet
seal verify --proof dist/proof.json --input dist/dist-manifest.json --json
seal public-key --json
seal sign --input example.txt --recipient age1... --out example.seal.json --quiet
seal verify --artifact example.seal.json --json
```

`SEAL_IDENTITY` may instead contain the serialized Identity v2 JSON and takes precedence
over `SEAL_IDENTITY_FILE`. Identity and mnemonic output files are created/written with
owner-only mode `0600`. `--quiet` suppresses normal output; without it, identity creation
may print the secret identity/backup when JSON output is requested. Keep signer files
outside the directory being manifested. Manifest creation hashes the actual files in
its input tree, skips `.DS_Store` and non-file/non-directory entries, and includes
prototype-like filenames safely. Use a clean build directory before generating the
manifest/proof/public-key outputs into it.

| Exit | Meaning                                             |
| ---- | --------------------------------------------------- |
| 0    | Success, including help                             |
| 1    | General/argument/encryption failure                 |
| 2    | Subject or artifact hash mismatch                   |
| 3    | Invalid signature or signer key binding             |
| 4    | Malformed proof/artifact schema or JSON             |
| 5    | Missing, unreadable or invalid signer configuration |

The separately maintained Seal Action accepts `package-name`, `package-version` and
`cli-command`. Its observed defaults still target the old package name. Select
`@ternent/seal` and an actually published version when using its package path; an
explicit CLI override can exercise a locally installed candidate. This migration
proves its manifest/sign/public-key command sequence against the installed executable;
it does not change or release that Action or claim a registry-backed Action run.

[Migration and verification notes](../../docs/engineering/seal-migration-2026-11-20.md)
record checks and remaining limits.

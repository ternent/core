# Concord alpha protocol 1

Shipping update, 2026-11-20: independent groups and readable replay are implemented.
The [standard profile](standard-profile.md) and [group contract](group-profile-design.md)
define the pre-release revision; canonical encoding, hashing and signatures are unchanged.

Status: implementation contract, 2026-10-21. Read with the
[blueprint](implementation-blueprint.md), [standard profile](standard-profile.md),
and [conformance plan](conformance.md). MUST and MUST NOT are normative. These are new
alpha formats; legacy `concord-ledger` containers and Seal proofs are not this format.

## 1. Values and bytes

`Json` is null, boolean, Unicode string, safe integer, array of Json, or an object
whose own string keys map to Json. Numbers MUST be integers in
`[-9007199254740991, 9007199254740991]`. Negative zero is rejected, including the
lexical forms `-0` and `-0.0`. Fractions, non-finite numbers, sparse arrays,
undefined, bigint, functions, cycles, accessors, symbol keys, and custom prototypes
are rejected at the authoring interface. Parsed objects may have a null prototype.
Decimal application values use model-defined strings. No coercion or normalization.
`JsonObject` denotes an object of such values; it excludes arrays and null.

`C(value)` is UTF-8 without BOM of the JSON Canonicalization Scheme in
[RFC 8785](https://www.rfc-editor.org/rfc/rfc8785.html), restricted to the above
numeric domain. Object keys sort by unsigned UTF-16 code units recursively; array
order is preserved. Strings preserve their Unicode form. Lone surrogates are
rejected. Thus visually identical normalized and decomposed strings may hash
differently. Export uses `C(snapshot)`, with no trailing newline.

Import accepts non-canonical JSON whitespace and key ordering, but MUST use a
duplicate-detecting, strict UTF-8 parser before making objects. Duplicate decoded
keys (including escape aliases), BOM, invalid UTF-8, trailing data, invalid JSON,
and numbers outside the value domain fail. Inspect raw bytes on failure; do not
parse with `JSON.parse` alone and lose evidence. Validate numeric tokens before
rounding to binary64; evaluate the token's mathematical decimal/exponent value as an
exact rational first. It must be integral and in range. A fraction or out-of-range
value MUST NOT round into an accepted integer.
An integral representation such as `1.0` or `1e0` imports as 1; export emits 1.

`B(bytes)` is canonical unpadded base64url (RFC 4648 section 5): URL alphabet only,
zero unused bits, no whitespace or `=`, and decode/re-encode equality. Hashes use
lowercase hexadecimal. All protocol objects are closed: missing or extra fields
fail schema validation. Fields typed `JsonObject | null` are the explicit open
metadata slots. Required nulls are not omitted. No timestamps are required or
used for ordering; a model can record authored time as event data.

## 2. Identity and algorithms

The sole suite string is `concord-25519-age-v1`. `PublicIdentity` has exactly:

```ts
type PublicIdentity = {
  version: 1;
  algorithm: "Ed25519";
  publicKey: string; // B(raw compressed 32-byte Ed25519 key)
  id: string; // "identity:" + lowercase hex(SHA-256(raw public key))
};
```

Identity ID deliberately preserves the existing raw-key SHA-256 derivation while
giving the identifier a type prefix. Created time and private seed are excluded.
Reject mismatched IDs, non-canonical point encodings, identity/small-order points,
and points outside the prime-order subgroup. This validation also applies to
signature R points. Decode points using RFC 8032, require `[L]P = identity` and
`P != identity`, where `L = 2^252 + 27742317777372353535851937790883648493`.
Signature scalar S MUST be less than L. Verify the uncofactored equation
`[S]B = R + [H(R || A || message) mod L]A`. Alpha deliberately disallows permissive
ZIP-215 acceptance; adapters must configure or wrap their crypto library accordingly.
Ed25519 refers to PureEdDSA in [RFC 8032](https://www.rfc-editor.org/rfc/rfc8032.html),
not Ed25519ph or Ed25519ctx.

The private root is exactly a 32-byte Ed25519 seed. For X25519, compute SHA-512(seed),
take its first 32 bytes, clear the low three bits of byte 0, clear bit 7 of byte 31,
and set bit 6 of byte 31. For the public conversion, decode Edwards y, then compute
`u = (1+y)/(1-y) mod (2^255-19)` and encode u as 32-byte little endian. Validate the
Edwards point first; reject denominator zero. The private and public routes MUST
produce the same X25519 public key. This is the conversion described by
[libsodium](https://libsodium.gitbook.io/doc/advanced/ed25519-curve25519), not a
second seed or a mnemonic derivation. Mnemonics are outside the wire contract.

Encode X25519 public keys as lowercase Bech32 HRP `age`, and secrets as uppercase
Bech32 HRP `AGE-SECRET-KEY-`, with the original Bech32 checksum, not Bech32m.
Use the X25519 recipient and binary file format of
[age v1, C2SP revision v1.1.0](https://c2sp.org/age@v1.1.0).
Concord authors only X25519 recipient stanzas, no armor, passphrase, SSH, or plugin
recipients. Armour owns age implementation; Concord MUST NOT implement an alternate
encryption construction. Age bytes are stored as B(bytes). Fresh age file keys,
ephemeral keys, and nonces are required for every encryption.

## 3. Wire schema

The types below describe JSON, not caller-supplied executable code. `EntryId` is
`entry:` followed by 64 lowercase hex characters; `CommitId` uses `commit:`.
`Nonce` is B(16 CSPRNG bytes). `ModelRef.id` matches
`^[a-z][a-z0-9.-]{0,127}$`; `version` is an integer from 1 to 2147483647.
All other string lengths below are UTF-8 byte lengths, unless stated otherwise.

```ts
type ModelRef = { id: string; version: number };
type Declaration = {
  system: ModelRef; // alpha authors { id: "concord.standard", version: 1 }
  model: ModelRef;
};
type Snapshot = {
  format: "concord";
  version: 1;
  documentId: CommitId;
  head: CommitId;
  commits: CommitRecord[]; // exactly genesis -> selected head
  entries: EntryRecord[]; // exactly flattened commit.entryIds order
  metadata: JsonObject | null; // unsigned container annotations
};
type CommitSubject = {
  version: 1;
  suite: "concord-25519-age-v1";
  parent: CommitId | null;
  nonce: Nonce;
  signer: PublicIdentity;
  declaration: Declaration | null;
  entryIds: EntryId[]; // nonempty; unique throughout this snapshot
  metadata: JsonObject | null; // signed; e.g. { message: "Rename board" }
};
type CommitRecord = {
  id: CommitId;
  subject: CommitSubject;
  signature: string; // B(64-byte Ed25519 signature)
};
type EntrySubject = {
  version: 1;
  parent: CommitId | null; // equals containing commit's parent
  nonce: Nonce;
  kind: "system" | "application";
  payload: SystemEvent | ProtectedEvent; // selected by kind
};
type EntryRecord = { id: EntryId; subject: EntrySubject };
type SystemEvent = {
  type: string;
  version: number; // positive ModelRef.version range; profile 1 uses version 1
  data: JsonObject; // exact per-event schema in standard-profile.md
};
type ProtectedEvent = {
  audience: AudienceId;
  epoch: number; // safe integer >= 0
  ciphertext: string; // B(binary age file)
};
```

`AudienceId` is `"document"` or `"group:" + B(16 random bytes)`, with a canonical
base64url suffix. The profile validates existence and authority for that audience. Application event names and data stay inside
ciphertext. The public envelope discloses signer identities, membership/capability
changes, epoch recipients, parent relationships, entry counts, sizes, and signed
commit messages. Messages and container annotations MUST NOT be advertised as private.

The canonical plaintext of an application entry is:

```ts
type EventPlaintext = {
  context: "concord.application/1";
  parent: CommitId; // application entries are forbidden in genesis
  nonce: Nonce; // equals outer entry nonce
  model: ModelRef; // equals genesis declaration
  audience: AudienceId;
  epoch: number; // equals outer epoch
  event: { type: string; version: number; data: Json };
};
```

System and application event types use the same string grammar as ModelRef.id;
event versions use the same positive integer range. Exact system event data validation
belongs to the declared profile; application data validation belongs to its model.

Encrypt C(EventPlaintext) to the current group epoch recipient. On decryption,
require exact canonical plaintext bytes and all contextual equalities. Entry nonce
and parent bind ciphertext to its authored location without a self-referential ID.
Commit signer is the sole actor for every entry in that commit; there is no separate
actor claim. A model may record a subject such as assignee, but cannot claim it signed.
Copying ciphertext to a fresh envelope cannot pass these checks.

## 4. Identifiers and signature subject

`||` means byte concatenation; each displayed `\0` below is one zero byte.

```text
entry.id  = "entry:"  + hex(SHA-256(UTF8("concord.entry/1\0")  || C(entry.subject)))
commit.id = "commit:" + hex(SHA-256(UTF8("concord.commit/1\0") || C(commit.subject)))
message   = UTF8("concord.signature/1\0") || C(commit.subject)
signature = B(Ed25519.Sign(seed, message))
```

Neither identifier field nor signature is in the unsigned subject. Sign the subject
bytes above, not the ID text, its digest, a Seal artifact, or a surrounding container.
Ordered entry IDs and parent linkage are therefore covered by both ID and signature.
Entry signatures are unnecessary: the containing commit authenticates their hashes.
Identity capability `sign` accepts these exact bytes without adding its own context.
Legacy Identity `signBytes` adds a prefix and cannot be substituted unchanged.

Each authoring operation allocates a fresh commit nonce and one nonce per entry.
Reject repeated entry nonces within one commit as `SCHEMA_INVALID`. Random collisions across histories do
not define equivalence; IDs and ancestry do. Equal commands issued again normally
produce different snapshots. Tests replay saved ciphertext and entries.

## 5. Genesis, chain, and container validation

Validation order is: resource limits and parsing; supported outer version and schema;
array/ID uniqueness and exact membership; subject hashes; linkage and declaration;
identity/signature validation in genesis-to-head order. Stop at the first failure
in this order and report the array index/JSON pointer. Never invoke extension code
before protocol validation succeeds.

1. There is at least one commit. The first has null parent and non-null declaration;
   every other commit has null declaration and points to the immediately preceding
   commit's ID. Its suite and version remain constant.
2. `documentId` equals first commit ID; `head` equals last commit ID. No cycles,
   gaps, empty commits, extra roots, or alternatives in the same container.
3. Each listed entry exists exactly once, in flattened order. Extra/unreferenced
   entries or commits fail `UNREFERENCED_RECORD`; repeated references or records
   fail `DUPLICATE_RECORD`. No detached bytes are silently ignored as trusted history.
4. Each entry's parent matches the containing commit parent. All hashes match and
   all signatures pass. System event meaning and signer authority are checked later.
5. Protocol verification can succeed without knowing the model or system profile.
   Parse declaration refs structurally; an unrecognized ref is a runtime requirement,
   not a bad signature. This alpha authors only the standard profile reference.

Unsupported outer versions/suites return `unsupported`, never an assertion of invalid
cryptography. A schema-valid unknown entry kind also requires unsupported inspection;
this version authors only the two declared kinds. Known-kind malformed payloads fail
schema validation. A missing ancestor is invalid/incomplete, never partial readiness.
Alpha accepts no checkpoints or authoritative replay ranges.

Container annotations can be changed without invalidating history. Signed commit
metadata cannot. Editing head to a real ancestor and removing its descendants yields
a different valid older snapshot; editing head alone fails HEAD_INVALID because it
does not select the final commit in the supplied chain. Integrity cannot detect the
former as stale without an external anchor.

Default host resource limits are 16 MiB input/export, 10,000 commits, 100,000 entries,
1 MiB decoded ciphertext per entry or key wrap, 64 nesting levels, and 64 KiB canonical
metadata per slot. These are implementation limits, not signature semantics. Exceeding
one yields `RESOURCE_LIMIT` with status `unsupported`, not `invalid`. A host can lower
or raise limits explicitly; all implementations must accept the supplied bounded vectors.
Bounds are checked before allocations and decryption. Do not traverse recursively
without a depth bound or assign attacker keys through object prototypes.
For the depth limit, a root primitive has depth 0, a root object/array depth 1, and
each nested object/array adds 1. Ciphertext bounds apply independently to application
files and each key wrap; metadata bounds apply independently to each metadata object.

## 6. Snapshot relationships and anchors

`compareSnapshots(a, b)` first protocol-verifies both. Different document IDs return
`unrelated`; same heads return `equal`; if a.head is in b's ancestry return `behind`;
if b.head is in a's ancestry return `ahead`; otherwise return `diverged`. These names
describe a relative to b. Invalid/unsupported inputs return an error, not a relation.
Matching IDs with unequal subjects would be a hash failure and MUST NOT be reconciled.

`open({ anchor })` accepts a previously verified full snapshot (minimum alpha anchor;
checkpoints are deferred). Compare candidate to anchor: equal/ahead may proceed;
behind yields `STALE_HEAD`, diverged yields `DIVERGED_HEAD`, unrelated yields
`DOCUMENT_MISMATCH`. Keep integrity valid and return inspection. Supplying only an
unknown head cannot prove ancestry; alpha does not pretend it can. No implicit
anchor is inferred from a timestamp or storage revision.

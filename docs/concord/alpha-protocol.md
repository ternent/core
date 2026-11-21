# Concord profile over the common Ledger container

Accepted breaking alpha revision, 2026-11-21, under
[ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md). Ledger owns the
container, history lifecycle and all history cryptography. Concord supplies framework
records, authority, group encryption and application replay. Former Concord-only
containers and historical `concord-ledger` containers are not accepted by this alpha;
no import/conversion adapter is implied.

Read with [Ledger's format and interface](../../packages/ledger/README.md), the
[standard profile](standard-profile.md), [group contract](group-profile-design.md)
and [current vectors](vectors/README.md). MUST and MUST NOT describe the checked
contract, not historical fixture parity or completed registry publication.

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
metadata slots. Required nulls are not omitted. Ledger timestamps are signed canonical UTC ISO
strings; parent linkage and array order determine history order.

## 2. Identity and algorithms

Ledger uses the suite string `ledger-ed25519-v1`. `PublicIdentity` has exactly:

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

## 3. Framework records inside Ledger

The outer object is exactly the common Ledger snapshot: `format: "ledger"`,
`version: 1`, `documentId`, `head`, ordered `commits` and ordered `entries`.
There is no outer Concord format, signature domain or unsigned annotation slot.
Ledger entry/commit IDs and signatures use its `ledger.entry/1`, `ledger.commit/1`
and `ledger.signature/1` domains, each followed by NUL and the canonical subject.
The full raw subject, including timestamps and metadata, is bound by the history.

The signed genesis commit metadata is exactly:

```ts
{ concord: { system: { id: string, version: number }, model: { id: string, version: number } } }
```

References use lowercase IDs matching `^[a-z][a-z0-9.-]{0,127}$` and integer versions
from 1 to 2147483647. Only genesis metadata establishes these requirements. Later
commit metadata is arbitrary signed JSON metadata and cannot replace the declaration.
A syntactically valid unknown reference is a runtime requirement, not a bad signature.

Concord uses raw Ledger entries with `kind: "system" | "application"`:

- `system`: `subject.payload.data` is `{ type, version, data }`, where data is a JSON
  object. The standard profile owns its event schemas and historical authority.
- `application`: `subject.payload.data` is `{ audience, epoch, ciphertext }`.
  Audience is `document` or a canonical 16-byte `group:` identifier; epoch is a
  non-negative safe integer; ciphertext is canonical base64url of a binary age file.

The raw Ledger payload envelope is `{ type: "plain", data: <framework record> }`.
This describes its JSON representation; encrypted application content stays ciphertext.
The Ledger subject's parent, nonce and bound author supply the history context.
Concord's prepared/replay `EntrySubject` is a logical view retaining the raw entry ID;
it is not another signed subject and MUST NOT be independently hashed as the wire record.

## 4. Verification, authoring and replay

Ledger first enforces strict parsing, resource bounds, closed record schemas,
identity validity, unique/ordered referenced records, content hashes, parent linkage
and signatures. Genesis may be empty in standalone Ledger; Concord's standard
profile creates one initial system record atomically in its genesis commit.
Only after Ledger verification may Concord validate framework envelopes/declaration,
execute the system pass, decrypt available content and run application replay.
Invalid or incomplete reachable history never produces a trusted application state.

Concord delegates create/load, entry staging, commits, verification and export to
Ledger. It retains application command-intent drafts and previews. At commit time it
prepares records, builds a private Ledger candidate, and runs the complete framework
validation/replay before adopting that candidate and projection together. Failure
preserves the active history and pending command draft. Export contains committed
Ledger history; storage publication remains a separate host operation.

Default Concord limits remain 16 MiB input/export, 10,000 commits, 100,000 entries,
1 MiB decoded ciphertext per application entry/key wrap, 64 nesting levels and
64 KiB canonical metadata per slot. Metadata bounds include the signed genesis
declaration. Exceeding a bound returns `RESOURCE_LIMIT`/unsupported. Limits are
checked before decryption and publication; framework replay and metadata access
must not bypass the limits already enforced by Ledger.

Integrity is separate from authority, decryptability, application validity and
freshness. A standalone Ledger reader can verify the same bytes without Concord's
model or group keys. A valid older prefix remains cryptographically valid; only an
external remembered head can establish that it is stale. There is no automatic merge.

## 5. Snapshot relationships and anchors

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

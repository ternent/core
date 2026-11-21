# @ternent/ledger

A standalone signed append-only log. Create or load a log, stage JSON entries,
commit them, verify the history and replay it into a projection. Ledger has no
dependency on Concord, Armour, Seal, a framework, storage or Node filesystem APIs.

```ts
import { generateSigner } from "@ternent/identity";
import { createLedger } from "@ternent/ledger";

const signer = await generateSigner();
if (!signer.ok) throw new Error(signer.error.code);

const log = await createLedger({ signer: signer.value });
await log.create({ metadata: { title: "Readings" } });
await log.append({ kind: "temperature", payload: { value: 21 } });
await log.commit({ metadata: { source: "sensor" } });

const snapshot = await log.export();
const reader = await createLedger();
await reader.load(snapshot);
const report = await reader.verify();
const entries = await reader.replay();
```

`create()` immediately signs a genesis commit. It is empty by default; an `entries`
array can supply initial records atomically. Advanced encrypted-envelope builders
may supply a 16-byte base64url `nonce` when appending; duplicate nonces in one commit
are rejected. `append()` and `appendMany()`
stage entries and update the local preview. `export()` and `verify()` concern the
committed snapshot only. Replay includes staged entries by default; pass
`{ includeStaged: false }` for committed-only reconstruction. Each replayed entry
has `committed` and `commitId` fields, so a preview never masquerades as signed history.
`clearStaged()` discards the preview without changing committed history.

Supply `initialProjection` and a synchronous `projector(projection, entry)` to derive
your own state. Without them, replay returns the ordered entries. `getState()` gives
a detached, frozen state; `subscribe()` observes successful changes. Projectors must
be pure and return portable JSON. Callbacks must not await operations on the same Ledger handle.

Mutations are serialized. Inputs are captured when called. Failed validation,
projection or signing preserves the previous committed snapshot and staged entries.
Loading while entries are staged rejects with `DRAFT_PENDING`; commit or clear them
first. Validation and signing failures reject with `Fault`, whose `finding` provides a code
and phase. Projector exceptions propagate while preserving the previous state.
Observer exceptions cannot roll back a published state. `destroy()` closes the local
handle; it does not erase exported history or data held elsewhere.

The `ledger` v1 format uses strict canonical JSON, content-addressed entries and
commits, parent linkage and Ed25519 signatures. A commit signature binds its signer,
ordered entry IDs, timestamp and metadata. Entry authors bind to their commit signer.
An explicit signer can append to any valid log: membership, permissions, encryption
and application rules belong to the host or Concord. Store opaque ciphertext as JSON
when composing Ledger directly with an encryption library.

`verifyLedger(bytes)` checks the full signed history without opening a handle.
`compareLedgers(a, b)` reports equal, ahead, behind, diverged or unrelated snapshots;
it never merges or chooses a head. Integrity proves neither freshness nor completeness
without a remembered head or external anchor. The host owns storage and publication.

The specialist `/protocol` export supplies the same concrete Ledger codec, identifiers,
signature subjects and verifier, without loading the authoring lifecycle. Concord
consumes Ledger's lifecycle and puts its framework records in this same container;
it does not maintain a second signed container or commit engine. A Ledger reader
requires no Concord declarations, model, permissions or group keys to verify history.

## Optional payload codecs

Ledger supports Armour integration through explicit payload composition. It has no
Armour dependency, recipient configuration, key management or automatic decryption.
`encodePayload(data, codec)` turns portable JSON into a versioned JSON envelope for
the ordinary `append()` API. `decodePayload(data, codec?)` reads that envelope after
replay. A codec is just an `id` and optional asynchronous byte `encode`/`decode`
functions; there is no plugin registry or lifecycle to configure.
`encodePayload` requires a `LedgerPayloadEncoder`, so reader-only or unknown
encoding capabilities are rejected by TypeScript. `LedgerPayloadDecoder` describes
a guaranteed decoder; the general `LedgerPayloadCodec` keeps both methods optional
for inspection and locked-result handling.

```ts
import { encodePayload, decodePayload } from "@ternent/ledger";
import { ageRecipientFromPublicIdentity } from "@ternent/identity";
import { createAgeCodec, withAgeDecryption } from "@ternent/armour";

const identity = withAgeDecryption(signer.value);
const recipient = ageRecipientFromPublicIdentity(identity.publicIdentity);
if (!recipient.ok) throw new Error(recipient.error.code);
const codec = createAgeCodec({ recipients: [recipient.value], reader: identity });

await log.append({
  kind: "private-note",
  payload: await encodePayload({ text: "Only the recipients can read this" }, codec),
});
await log.commit();

const entry = (await log.replay()).at(-1)!;
const result = await decodePayload(entry.payload.data, codec);
// { status: "decoded", data: { text: "Only the recipients can read this" } }
const withoutKeys = await decodePayload(entry.payload.data);
// { status: "locked", codec: "age" }
```

Plain JSON returns `{ status: "plain", data }`. A missing or different codec, an
encode-only codec, or a decoder returning `null` produces a locked result. Armour
returns `null` when its reader cannot authenticate/decrypt the ciphertext; this does
not distinguish a wrong key from malformed ciphertext. Codec exceptions propagate.
Invalid envelopes or decoded JSON reject. Encoding failures reject before append;
there is no plaintext fallback. The helpers use Ledger's portable JSON rules and
default byte/depth limits; their optional last argument accepts `maxBytes` and
`maxDepth`. Limits apply to both decoded JSON and the encoded envelope.

The envelope has exactly `format: "ledger-payload"`, `version: 1`, `codec` and
canonical base64url `data`. This marker is reserved within payloads decoded by this
helper. The log treats it as opaque JSON; verification, commits, export and raw
replay require no codec. Decoding never modifies signed bytes or establishes their
trust. Only payload data is encrypted: entry kind, author, timestamps, metadata and
history structure remain visible. The host decides which decoded data to project;
Ledger's synchronous projector continues to receive the recorded payload.

Staged entries stay in a simple in-memory array. The consumer chooses when to commit
and owns any draft autosave or recovery. Ledger has no draft persistence adapter,
recovery snapshot or restore API. Committed `export()` remains signed-history only;
external storage and push/pull workflows exchange committed snapshots. See
[the persistence decision](../../docs/adr/0019-keep-draft-persistence-with-consumers.md).
No historical `concord-ledger` or former Concord-alpha import adapter is included.

## Container format

The container has exactly `format: "ledger"`, `version: 1`, `documentId`, `head`,
ordered `commits` and ordered `entries`. The genesis commit defines `documentId`;
`head` is the last commit. Every committed entry is referenced exactly once in order.
Records and subjects are closed objects; `meta`, commit `metadata` and payload data
are the explicit JSON slots. Timestamps are signed canonical UTC ISO strings, while
parent linkage and array order determine history order.

Given strict canonical JSON bytes `C(subject)`, IDs are lowercase SHA-256:

- Entry: `entry:` + SHA-256(UTF8(`ledger.entry/1`) + NUL + `C(entry.subject)`).
- Commit: `commit:` + SHA-256(UTF8(`ledger.commit/1`) + NUL + `C(commit.subject)`).
- Signature: Ed25519 over UTF8(`ledger.signature/1`) + NUL + `C(commit.subject)`.

The commit suite is `ledger-ed25519-v1`. Nonces are 16 bytes; signatures are 64 bytes;
wire bytes use canonical unpadded base64url. Entry authors must equal their commit
signer's identity ID. Hashes include the full subjects: metadata, parent links,
nonces, timestamps and ordered entry IDs. Public types define the exact record fields.

Build and test with the repository's pinned toolchain. Installed-package checks cover
Node 22.18, 24 and 26, browser execution, declarations and isolated imports. ISC licensed.

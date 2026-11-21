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

The current migration implements portable JSON payloads and externally owned storage.
The original standalone recipient-encryption convenience and staged-state persistence
are still explicit retain/move/drop decisions; neither is established by the common
container change. Committed `export()` is not a recovery format for staged work.
No historical `concord-ledger` or former Concord-alpha import adapter is included.

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

# Concord alpha architecture

Current container/ownership revision: [ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md)
and [the Ledger-backed profile](alpha-protocol.md) supersede the Concord-only wire,
signing domains and internal-Ledger ownership described in this earlier plan.
Ledger is a standalone public product. Concord delegates its history lifecycle;
UI and public Tooling are outside the five-product release.

Shipping update, 2026-11-20: [ADR 0015](../adr/0015-keep-audience-memberships-independent.md)
extends the initial single-audience scope with independent memberships. The
[group contract](group-profile-design.md) distinguishes complete projection
from explicitly scoped readable replay; atomic publication and full reachable
history verification still apply. B03/B04 now implement that contract.

Status: accepted direction, 2026-10-21. This is the target for a clean rebuild. Existing
packages and specifications are evidence, not a compatibility requirement, unless this
document explicitly preserves a behavior.

The [implementation blueprint](implementation-blueprint.md) specifies the alpha's wire
format, interfaces, standard-profile semantics, conformance vectors, and delivery gates.
Use it to implement this direction; the architecture below remains the product rationale.

## Product definition

> Concord lets TypeScript developers build small user-owned applications whose durable
> state is a portable, signed document that can be stored anywhere, verified
> independently, and rebuilt through deterministic replay.

The first developer using Concord will usually be a coding agent. The interface should
therefore have a small number of explicit concepts, strong types, structured failures,
and fast conformance checks. The runtime should own difficult lifecycle and security
mechanics while leaving application meaning and storage behavior replaceable.

Concord is intended for bounded records and data-entry applications. A document should
stay small enough to understand, move, inspect, and eventually replace. Software that
combines several documents belongs above Concord.

## Design rules

1. Signed history is authoritative; every projection is derived.
2. The same exact document snapshot, conforming models, and available capabilities
   produce the same projection when their replay functions are deterministic.
3. A document remains portable across storage providers and independently verifiable.
4. The host chooses executable code. A document declares requirements but never causes
   untrusted code to load.
5. System mechanics and application meaning have separate extension classes.
6. The standard system profile contains identities, authority, and privacy, not users or
   profiles.
7. The smallest useful contract wins. Synchronization, directories, profiles, and
   multi-document experiences stay outside the core runtime.

## Conceptual shape

```text
application UI or agent
          |
          v
typed application model   commands -> domain events -> projection
          |
          v
standard system profile   signer binding, authority, audiences, encryption
          |
          v
Concord runtime           open, verify, replay, commit, inspect, export
          |
          v
protocol                  canonical bytes, hashes, signatures, chain validation
          |
          v
storage adapter           read document / write document
```

These are responsibility boundaries, not necessarily public packages.

## Concord document

A document contains:

- its protocol and cryptographic-suite versions;
- the required system profile and application model identifiers;
- an ordered, signed commit history;
- entries carried by those commits; and
- non-authoritative container metadata where useful.

Each commit binds its canonical contents, ordered entry identifiers, parent commit, and
signer. Validation rejects altered, missing, reordered, or incorrectly signed reachable
history.

The application model is fixed when the document is created. Alpha has no in-place model
upgrade mechanism. Updated software continues to read older model versions. A breaking
change uses an explicit migration tool to read the old document and author a new one;
the new document may record ordinary `derivedFrom` provenance. Concord gives that
metadata no authority. A migration can contain application-specific upcasters without
making upcasting part of replay or changing the old history.

A byte-for-byte copy is still the same document snapshot. The genesis commit identifier
is the document ID shared by its lineage. Every snapshot selects exactly one head; the
head identifier names that exact snapshot, and its trusted history is the single parent
chain reachable from the head. Copies may continue from the same verified commit and
later diverge. Both variants can be valid; they share a document ID but are no longer the
same snapshot.

The protocol defines how to compare two snapshots as equal, ahead, behind, or diverged.
It never combines divergent histories or silently selects a winner. Alpha has no merge
operation for divergent snapshots. Storage and product integrations must retain and
surface both or ask a person to select one; they cannot describe either action as a
cryptographic merge.

If an application needs to combine meaning from both variants, it authors a new document
with a new genesis and may reference both source heads in ordinary provenance metadata.
The source snapshots remain independently auditable, and the new author's signature
attests to the resolution rather than impersonating the original authors. The resolver
signs the new genesis and becomes its initial owner through the normal create lifecycle.
Capabilities, audiences, and encryption keys from the source documents do not carry over
implicitly; the new document grants them explicitly. A combined container with ambiguous
heads cannot produce a trusted projection and opens for inspection.

## Runtime lifecycle

### Create

Creating a document selects one system profile and one application model. The genesis
signer becomes the initial owner with read, write, grant, and administer capabilities.
The first commit records the declarations and initial system state.

### Open

`open` owns the complete trusted-read lifecycle:

1. read or accept a document;
2. validate its container and complete reachable history;
3. resolve trusted implementations for the declared system profile and application
   model;
4. replay system entries to establish identities, capabilities, and decryptability;
5. supply decrypted application events and explicit locked markers in their original order; and
6. publish projection and coverage together once the whole opted-in model pass succeeds.

Integrity validity and model validity are separate. An unknown model is not tampering.
It means the host cannot produce a complete trusted application projection.

Integrity validity is also separate from freshness and completeness. A valid signature
cannot prove that storage returned the newest known head or disclosed every divergent
variant. A host that remembers a prior head or trusted checkpoint can detect an older or
divergent response; a host with no external anchor cannot.

Invalid, locked, or incompatible documents return an inspection handle rather than
disappearing behind a generic load error. It exposes raw history, validation findings,
missing requirements, locked-entry counts, and export facilities. It does not expose a
trusted projection or allow writes.

### Author

Application code dispatches a typed command. Its application model validates the input
and returns domain events. The system profile binds the actor to the active signer,
checks capabilities, applies audience protection, and creates the protocol entries.
Application code does not handle raw keys, permission state, or entry envelopes.

Concord supports two authoring modes over the same history model:

- **Immediate** is the default: a successful command creates a signed local commit.
- **Draft** groups several successful commands into one explicit commit with optional
  metadata such as a message.

Storage publication is separate from local commit creation. A storage adapter decides
whether writing is immediate, explicit, remote, synchronized, or conflict-aware.

### Export

Export returns the portable document. The exported artifact must be sufficient for an
independent implementation to validate its history and, when it has the declared models
and required keys, reproduce its projection.

## Extension contract

Concord recognizes exactly two execution classes.

### System extensions

System extensions are selected by the trusted host to satisfy a document's declared
system profile. They own:

- public identities and signer binding;
- capabilities such as read, write, grant, and administer;
- privacy groups, audiences, and key distribution;
- decryption before application replay; and
- authorization before application events are recorded.

The official alpha system profile is used from genesis, including for a single-owner
document. A deliberately public specialist profile may be added later without weakening
the default.

### Application models

The primary application interface is declarative and typed:

- stable model identifier and version;
- initial projection state;
- typed commands with input validation and decision functions;
- versioned event validation; and
- pure reducers.

A document has one bounded application model. Several interfaces may understand that
model, but unrelated application schemas do not accumulate in one long-lived document.
Low-level replay hooks may exist as a specialist surface; they are not the normal way to
build an application.

An application model may declare the audience and capability required for an operation.
During replay it receives authorized, decrypted domain events and stable system facts,
not mutable security internals. An explicit `reduceLocked` hook opts into missing-event
markers. A full model requires every event; a readable view certifies only available
semantics, with coverage and locked counts on every public projection result.

### Deterministic replay conditions

Concord makes determinism a model contract and a conformance target rather than claiming
that TypeScript can enforce purity. Reducers and system replay functions must depend only
on their ordered inputs and declared deterministic context. Time, randomness, generated
identifiers, locale-sensitive behavior, and external reads must be captured in authored
events before replay. Canonicalization and numeric behavior must be specified for every
protocol value.

Independent signature verification does not require application code. Reproducing an
application projection additionally requires a conforming implementation of the declared
system profile and application model. Shared model vectors should catch incompatible
implementations; the trusted host remains responsible for selecting the implementation.

## Identity and cryptography

The alpha suite is fixed and versioned:

- Ed25519 for signatures;
- identity ID derived from the canonical Ed25519 public key;
- deterministic Ed25519-to-X25519 conversion;
- age-compatible X25519 recipient encryption; and
- typage through the pure TypeScript `age-encryption` package, without WASM initialization.

One seed is the identity capability root. Its Ed25519 key signs; its deterministically
converted X25519 key decrypts. Concord does not store a second encryption public key.
The exact conversion, canonical encodings, and expected outputs are normative protocol
material with shared cross-language vectors.

The Identity API separates:

- `PublicIdentity`, safe for documents, containing version, algorithm, public key, and
  derived ID; and
- `IdentityCapability`, held by the host, containing private material and signing and
  decryption operations.

Profiles, names, avatars, emails, presence, and peer discovery are not system records.
An application may model them when they belong to its domain. An optional identity
directory may map identities to profiles and facilitate peer or real-time connections.
Offline interfaces can represent an identity with a deterministic glyph derived from
its ID.

Alpha does not define key rotation, account recovery, or continuity proofs. Replacing a
key introduces a new identity and requires an authorized grant.

## Privacy and authority

Privacy and authority remain distinct:

- an audience determines who can decrypt;
- a capability determines who may perform an operation;
- historical key possession records what an identity may already know;
- active membership records current group participation; and
- revocation prevents future access or writes but cannot erase previously obtained keys
  or plaintext.

Friendly products may present viewer, editor, and owner presets. They compile to the
separate audience and capability rules rather than replacing them.

Authority is evaluated along the selected head's ancestry. An editor who authors from a
parent before their revocation may create a valid divergent variant in which the later
revocation never occurred. That commit cannot be inserted after the revocation or merged
silently into the revocation branch. Neither variant is globally canonical from the
signatures alone. Detecting or rejecting the unwanted variant requires a remembered head,
trusted checkpoint, or another external coordination mechanism.

## Security and privacy limits

Signatures establish integrity and authorship within the selected history. They do not
establish freshness, availability, global completeness, or consensus between writers.
Storage can withhold a branch or return an older valid snapshot; Concord can only detect
this when the host has an external freshness anchor.

Encrypting entry payloads does not necessarily hide envelope metadata such as authors,
commit cadence, ciphertext sizes, or relationship patterns. The exact public envelope
must be minimized and documented in the protocol.

Append-only history and uncontrolled copies mean Concord cannot promise universal
erasure. Removing keys can make encrypted content inaccessible to a particular host but
cannot retract plaintext or keys already obtained. Applications with deletion or legal
retention requirements must account for that limit explicitly.

## Storage boundary

The minimum storage adapter can read and write a complete document. Concord validates
documents after reading and before exposing trusted state. Storage never establishes
authority and cannot silently repair, rewrite, invent, or combine signed history.

Adapters may independently add compare-and-swap, revisions, subscriptions, Solid pod
behavior, peer exchange, push/pull, or conflict presentation. Those capabilities do not
expand the core storage contract or change application-model behavior. In alpha,
"handling" a divergence means retaining it, presenting it, or asking the caller to pick
a variant; it does not mean synthesizing a merged Concord history.

A concurrency-aware adapter can accept an expected head and report divergence rather
than overwrite another writer. An adapter without that facility remains usable for
single-writer or externally coordinated storage, but cannot claim concurrent-write
protection. Shared applications should prefer expected-head writes so routine races are
rejected before one snapshot overwrites another. The rejected local snapshot remains a
valid variant; the application can reopen the accepted head and ask the author to issue
the intended command again. The runtime should expose that storage capability so
applications can communicate the difference.

## Protocol and interoperability

The protocol is part of the Concord product contract rather than a separately designed
product. It consists of a language-neutral specification, canonical encodings, and
conformance vectors. TypeScript helpers are published at `@ternent/concord/protocol`.
Normal application developers should not need to import them.

Rust, shell, or another implementation can interoperate by following the specification
and passing the same vectors. Vectors cover at least canonicalization, entry IDs, commit
IDs, signatures, parent linkage, identity derivation, age-recipient derivation, valid
documents, snapshot relationship classification, divergent revocation histories, and
representative tampering failures.

## Repository and packages

Keep one monorepo while the contracts are being established. Repository layout,
installable package boundaries, and release cadence are separate decisions.

The five public packages are Identity, Armour, Ledger, Concord and Seal. Ledger
owns the common signed container and history lifecycle. Concord composes commands,
authority, group encryption and application replay, with specialist `/protocol`,
`/system` and `/testing` subpaths. Workspace is deferred.

Storage integrations and applications are consumers. The libraries use ordinary
Vite+/TypeScript configs and exact-tarball acceptance under the
[repository guide](../engineering/repository-hygiene.md).

## Application consumers

Applications and demos live outside core and consume the libraries. The earlier
handshake pilot is retained in Git; it is not a library release gate. Current
acceptance exercises signed history, private membership, authoring, export and
deterministic replay through installed-package consumers, including a temporary
browser application. Hosts own draft persistence and publication of committed data.

## Deferred project-board example

One document represents one project board. The application model demonstrates:

- board metadata and columns or lists;
- task creation, editing, movement, assignment, and archival;
- identities represented without requiring profiles;
- viewer, editor, and owner capabilities;
- private audiences and shared encryption keys;
- immediate commands and grouped commits with messages;
- expected-head publication rejecting a routine stale write, plus two offline editors
  producing surfaced divergence with no silent merge;
- document export, reopen, deterministic replay, and history inspection; and
- useful inspection states for tampering, missing models, and locked entries.

A later explorer can open and compare several board documents. Multi-board aggregation
does not change the one-model-per-document rule.

## Explicitly deferred

Alpha does not require:

- in-place application-model upgrades;
- key rotation, recovery, or identity continuity;
- a profile, user, or account system;
- a network service, real-time transport, or peer-discovery protocol;
- a core push, pull, merge, or conflict-resolution algorithm;
- multi-document queries inside Concord;
- automatic loading of code named by a document; or
- multiple unrelated application models in one document.

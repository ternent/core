# Concord

Concord is the domain of portable, signed application documents whose trusted state is
rebuilt from their history. This glossary defines the language used across the runtime,
protocol, documentation, and examples.

## Document and history

**Concord document**:
A portable, single-head snapshot holding a signed commit history and the declarations
needed to interpret it.
_Avoid_: Ledger, database, workspace

**Entry**:
An immutable unit of recorded system or application meaning contained in a commit.
_Avoid_: Row, mutation, action

**Commit**:
A signed boundary containing one or more ordered entries and a link to its parent.
_Avoid_: Save, transaction

**Head**:
The commit selected as the tip of a Concord document snapshot.
_Avoid_: Latest version, current state

**Document ID**:
The genesis commit identifier shared by every snapshot in one document lineage.
_Avoid_: Head, storage key

**Divergence**:
The relationship between two valid snapshots whose heads share history but neither head
is an ancestor of the other.
_Avoid_: Invalid document, automatic merge

**Replay**:
Deterministic reconstruction from the ordered entries in a Concord document.
_Avoid_: Loading, event handling

**Projection**:
Derived state produced by replay and never treated as the authoritative record.
_Avoid_: Document state, source of truth

**Draft**:
An unpublished local group of intended entries awaiting one explicit commit. Its preview
is provisional and does not change the selected committed head.
_Avoid_: Unsigned history, saved document

## Identity and authority

**Public identity**:
A versioned Ed25519 public key and its derived identifier, safe to record and share.
_Avoid_: User, account, profile

**Identity capability**:
Private identity material and the operations it authorizes, held by the host outside a
Concord document.
_Avoid_: Private identity record, document identity

**Capability**:
An authority such as read, write, grant, or administer that a system extension assigns
to a public identity.
_Avoid_: Role, permission flag

**Audience**:
The identities allowed to decrypt a protected entry.
_Avoid_: Role, access level

**Privacy group**:
A managed audience with shared encryption material and membership history. Membership,
past key possession, and authority to write are separate facts.
_Avoid_: Role, team

**Audience epoch**:
A generation of a privacy group's encryption material. A later epoch protects future
entries without retracting knowledge of earlier entries.
_Avoid_: Identity rotation, erased access

## Runtime

**Host**:
The trusted application environment that supplies identity capabilities, storage, and
approved extension implementations to Concord.
_Avoid_: Server, owner

**System profile**:
The declared set of system semantics required to interpret a document, including
identity, authority, and privacy behavior.
_Avoid_: Core plugin bundle, user system

**System extension**:
A host-trusted implementation of system semantics that runs before application replay
and owns identities, capabilities, and encryption.
_Avoid_: First-class plugin, application plugin

**Application model**:
The single, versioned domain contract selected when a document is created, expressed
through commands, events, validation, and reducers.
_Avoid_: App type, replay plugin

**Application projection**:
Application state rebuilt from the authorized and decrypted events exposed by the
system profile.
_Avoid_: Database, document contents

**Inspection handle**:
A read-only view of a document that exposes history and diagnostics when a trusted
application projection cannot be produced.
_Avoid_: Broken runtime, partial app

**Freshness anchor**:
A head or checkpoint remembered outside a document and used to detect an older or
divergent snapshot served later.
_Avoid_: Signature, timestamp

## Boundaries

**Storage adapter**:
A replaceable integration that reads and writes complete Concord documents. Richer
synchronization behavior belongs to the adapter rather than the Concord runtime.
_Avoid_: Concord backend, sync engine

**Identity directory**:
An optional service or application facility that maps public identities to profiles,
presence, discovery, or peer connections.
_Avoid_: Concord user system, profile plugin

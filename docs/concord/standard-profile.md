# Standard system profile 1

Shipping design update, 2026-11-20: [ADR 0015](../adr/0015-keep-audience-memberships-independent.md)
accepts independent group memberships. The [group design draft](group-profile-design.md)
specifies the proposed multi-group changes for B03/B04. The single-audience contract
below describes the existing implementation; it is not the final shipping scope.

Status: implementation contract, 2026-10-21. Profile reference:
`{ id: "concord.standard", version: 1 }`. This profile has one document-wide private
audience, named `document`, and capability kinds `read`, `write`, `grant`, `administer`.
There are no profiles, role records, implicit accounts, or application policy here.

## Authority and privacy model

Genesis establishes its signer as the initial owner, holding all four capabilities.
Capabilities are a set; their wire array uses the order `read`, `write`, `grant`,
`administer`, with no duplicates. Every active member MUST have read; the other
capabilities are independent. A viewer has `[read]`, an editor `[read, write]`, and
an owner all four. These are caller presets rather than stored roles.

The audience's active members are exactly the current identities with nonempty
capabilities. A membership change does not change what earlier entries authorized.
At least one administrator MUST remain. `grant` permits adding a member or replacing
another member's capabilities with a subset of `[read, write]`, provided the actor
also holds each capability being granted and the target currently has neither grant
nor administer. `administer` permits setting any capability set or removing a member.
Neither privilege bypasses the prohibition on removing the final administrator.
An administrator need not also have grant. The genesis preset includes both.

Every application entry requires its signer to be an active member with write
immediately before that entry in history. A conforming model may require additional
capabilities from the same four and inspect historical system facts; it cannot weaken
write or read checks. Replay MUST check historical authority, not the final membership.

For this bounded alpha, admitting a member explicitly gives them the complete application
history. The member admission record carries wraps for all existing epochs. This is
required for a complete projection; partial-history admission is outside profile 1.
Authority to read at the selected head and possession of historical keys are checked
separately. A removed member may retain old keys, but the normal runtime exposes only
inspection for a head at which they lack read. They can still open an older authorized
snapshot, and revocation cannot prevent out-of-band decryption of material they hold.

## Group keys and key wraps

Each epoch has a fresh clamped 32-byte X25519 scalar and its age recipient. This is
audience material, not a second identity key. Private group scalars MUST NOT appear
in cleartext in the document. Generate 32 random bytes, clamp as X25519, and encode
the resulting scalar as B(bytes); recipients derive from scalar multiplication.

A wrap is a binary age file encrypted to exactly one member's derived identity
recipient. Its canonical plaintext is:

```ts
type KeyPlaintext = {
  context: "concord.audience-key/1";
  parent: CommitId | null; // containing system entry parent
  nonce: Nonce; // containing system entry nonce
  audience: "document";
  epoch: number;
  identityId: string; // target member
  recipient: string; // declared group epoch recipient
  secret: string; // B(clamped 32-byte group scalar)
};
type Wrap = { identityId: string; ciphertext: string };
type HistoricalWrap = { epoch: number; ciphertext: string };
```

Decrypting a wrap MUST check canonical plaintext bytes, every context field, scalar
clamping, and that its derived recipient equals the public epoch recipient. Bad wraps
addressed to this host yield `KEY_WRAP_INVALID`. Missing host capability yields locked
inspection. Other recipients' encrypted wraps cannot be certified as decryptable by
this host; a verification report MUST state that limitation. Do not claim knowledge of
their plaintext or guaranteed delivery. A future member with an invalid historical
wrap will inspect rather than reconstruct an incomplete projection.

Application entries encrypt their canonical event plaintext to the single epoch
recipient, using fresh age file material each time. Recipients of group wraps are
public membership metadata. A ciphertext's header cannot prove which parties know
its file key; authors must obey the recipient contract, and membership/wrap validation
does not claim cryptographic proof that an authorized author kept plaintext secret.

## Closed system event schemas

Every event has `{ type, version: 1, data }`. The exact data shapes below are
normative. Identity arrays and wrap arrays sort by identity ID, using ASCII order;
historical wraps sort by increasing epoch. Duplicate or missing elements fail.
All referenced identities pass protocol identity validation.

### `system.init`

```ts
type InitData = {
  audience: "document";
  epoch: 0;
  recipient: string;
  owner: PublicIdentity;
  wraps: [Wrap];
};
```

Genesis MUST contain exactly one entry, `system.init`. Owner equals the genesis
signer in every field. Its wrap is addressed to that owner for epoch 0. This entry
implicitly grants the owner all four capabilities and establishes the first audience
epoch. No application entries or additional system events in genesis. `system.init`
anywhere else fails `SYSTEM_EVENT_INVALID`. The declarations live in the signed
genesis commit, so the entry needs no self-referential document ID.

### `system.member.set`

```ts
type MemberSetData = {
  identity: PublicIdentity;
  capabilities: Capability[]; // nonempty and includes read
  history: HistoricalWrap[];
};
```

For a new or previously removed member, history MUST contain exactly one wrap for
every epoch from 0 through the current epoch, addressed to the target. Admission
does not rotate the epoch. For an existing member, history MUST be empty; its existing
historical access persists. A changed public key means a different identity; an ID
cannot be rebound. Setting an unchanged capability set fails `SYSTEM_NO_CHANGE`.
Evaluate grant/administer against the actor's facts immediately before the event;
then update facts for following entries. This event cannot remove read or membership.

An author admitting a new member must decrypt all historical group secrets to create
their wraps. If unavailable, authoring fails `HISTORICAL_KEY_UNAVAILABLE` atomically.
No network key requests, recovery, or partially admitted member state.

### `system.member.remove`

```ts
type MemberRemoveData = {
  identityId: string;
  epoch: number; // previous current epoch + 1
  recipient: string; // fresh group epoch recipient
  wraps: Wrap[]; // exactly all remaining active members
};
```

Requires administer, an active target, and at least one remaining administrator.
Remove all target capabilities and active membership, create the new epoch, and
wrap its fresh key to every remaining member, sorted by ID. Reject a recipient
equal to any previous epoch recipient. No wrap to the removed identity. Earlier
epoch records and wraps remain unchanged. Application entries after this event
MUST use the new epoch, including later entries of the same commit. Self-removal
is forbidden in profile 1 (`SYSTEM_EVENT_INVALID`); another administrator can remove
the identity. This keeps every successful authoring operation readable to its author
and avoids a special commit path that cannot complete application reconstruction.

No free-form `rotate`, separate identity registry, arbitrary permissions, or system
metadata events exist in profile 1. Future system versions can add semantics without
making profile-1 readers silently ignore unknown security events.

First route type/version: an unknown or unimplemented one gives UNSUPPORTED_SYSTEM_EVENT.
For a supported event, validation precedence is closed schema/identity/array encoding,
actor authority, target existence, unchanged transition, last-administrator protection,
self-removal prohibition, then epoch/wrap set invariants. Thus a last administrator's
attempt to remove itself reports LAST_ADMINISTRATOR; a non-final administrator's
self-removal reports SYSTEM_EVENT_INVALID. Ciphertext decryption follows the complete
public pass, not this per-entry sequence.

## Two-stage replay

After complete protocol verification, resolve the exact declared profile and model
from a host allowlist. Do not fetch modules, evaluate document strings, or substitute
the newest version. An absent implementation yields incompatible inspection.

Stage A starts from empty facts and scans genesis-to-head, commit order then entry
order. It validates system event transitions and application outer envelope authority,
records immutable per-entry facts, and accumulates epoch/wrap records. It runs for
every entry even if this host has no decryption key. An unknown system event produces
`UNSUPPORTED_SYSTEM_EVENT`, not a no-op. No application reducers run in Stage A.

Once public authority checks complete, evaluate the host reader's read at the selected
head. No capability, or absent active read, gives `READ_ACCESS_REQUIRED`. With an active
reader, unwrap its available epoch records across the whole selected history, including
historical wraps addressed to it by a later admission. Later access may decrypt earlier
entries but MUST NOT retrospectively authorize their signer. Verify all wraps addressed
to the reader, even duplicate grants of an already held epoch. A profile author must
use the appropriate latest admission after removal/re-admission; old retained keys are
not evidence of active read.

Decrypt every application entry with its recorded epoch, validate context, then pass
the model its event and immutable facts from that entry's original position. If any
required epoch is missing, count affected entries and return locked inspection. Never
skip unreadable entries and call the remainder a complete projection. An active reader
with all epoch keys may open without signing capability and remains read-only.

Stage B folds a fresh model initial state over all validated decrypted application
events. Unknown event type/version, invalid data, additional model-required capability
failure, invalid state transition, non-JSON projection, or reducer exception aborts the
whole pass. Publish only after both stages succeed. No mutable security objects or
raw keys cross into application code. External side effects from extensions are a
contract violation; there are no publish hooks in this alpha interface.

## System extension interface

`@ternent/concord/system` exposes the standard profile factory and specialist types.
The host passes a single profile implementation per exact reference. Alpha does not
compose order-dependent plugin arrays; a custom profile must define its own versioned
complete semantics and conformance vectors.

```ts
type VerifiedHistory = {
  // Private runtime brand prevents accidental construction; no public constructor.
  readonly documentId: CommitId;
  readonly head: CommitId;
  readonly declaration: Declaration;
  readonly ordered: readonly { commit: CommitRecord; entry: EntryRecord }[];
};
type ApplicationIntent = {
  kind: "application";
  event: DomainEvent;
  required: readonly Capability[];
  audience: "document";
};
type SystemIntent =
  | { kind: "member.set"; identity: PublicIdentity; capabilities: readonly Capability[] }
  | { kind: "member.remove"; identityId: string };
type SystemReplay = {
  entryFacts: readonly { entryId: EntryId; facts: SystemFacts }[];
  events: readonly { entryId: EntryId; event: DomainEvent; facts: SystemFacts }[];
  members: readonly { identity: PublicIdentity; capabilities: readonly Capability[] }[];
  epochs: readonly { epoch: number; recipient: string }[];
  reader: PublicIdentity;
  session: object; // opaque token; secrets kept in profile-private WeakMap
};
type SystemProfile = {
  ref: ModelRef;
  bootstrap(input: {
    signer: IdentityCapability;
    limits: Limits;
  }): Promise<Result<EntrySubject, ConcordError>>; // one parent-null init entry
  replay(input: {
    history: VerifiedHistory;
    reader: ReaderCapability | undefined;
    limits: Limits;
  }): Promise<Result<SystemReplay, ConcordError>>;
  prepare(input: {
    history: VerifiedHistory;
    current: SystemReplay;
    signer: IdentityCapability;
    intents: readonly (ApplicationIntent | SystemIntent)[];
    limits: Limits;
  }): Promise<Result<readonly EntrySubject[], ConcordError>>;
};
```

`VerifiedHistory` is runtime-issued and branded, not a public assertion a caller can
construct by casting JSON. Values passed across this interface are deeply immutable;
the runtime checks the profile's output covers exactly the expected application entry
IDs in order, with facts bound to their commit signer. `SystemReplay` is successful
only for an active reader with complete keys. Its session token has no public fields
or serialization, and private key material stays in the profile's WeakMap. Failure
returns ConcordError; locked errors carry `details.lockedEntries`, public transition
errors identify their record, and no partially decrypted output is returned.
`bootstrap` owns initial audience material, its owner wrap, and the init entry nonce;
the runtime owns the genesis declaration, commit nonce, subject, and signature.
`ApplicationIntent` has validated event, required capability set, and fixed document
audience. `SystemIntent` is `member.set` or `member.remove` with target identities and
capabilities; callers never supply epoch secrets or ciphertext. `prepare` generates
nonces, wraps, and ciphertext through Identity/Armour; the runtime constructs commit
subjects and signatures and verifies/replays the complete candidate before publishing.

The root application interface hides this specialist seam. During the first slice,
only `system.init` authoring is required. The standard implementation must advertise
its event support internally and return incompatible inspection for recognized but
unimplemented profile-1 events; it cannot claim profile-1 conformance until all three
events pass vectors. Do not invent a temporary public profile ID or downgrade to
plaintext during that increment.

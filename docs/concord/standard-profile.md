# Standard system profile 1

Status: implemented pre-release contract, 2026-11-20. Profile reference:
`{ id: "concord.standard", version: 1 }`. This revises the unpublished alpha in
place; no compatibility with older executables is promised. Genesis and the fixed
owner-only vectors retain their exact bytes. See [ADR 0015](../adr/0015-keep-audience-memberships-independent.md)
and [ADR 0016](../adr/0016-route-each-command-to-one-audience.md).

## Authority and privacy

`document` is the default group. Additional groups have independent members, keys,
and epochs. A `GroupId` is `group:` plus canonical base64url of 16 random bytes;
`AudienceId` is `"document" | GroupId`. Group IDs cannot be reused in a document.
Default-group membership is not required to join another group. Default-group
ownership gives no implicit read, write, grant or administer in other groups.

Genesis gives its signer all four capabilities in `document`. An actor with write
in `document` may create an independent group without owner approval; only its
creator receives the initial key and all four capabilities in that group.

Every active member has read. Capability arrays contain unique values in order
`read`, `write`, `grant`, `administer`. A grant holder may give a subset of read/write
that they hold, and cannot edit a member with grant/administer. An administrator may
set any nonempty set containing read or remove a member. At least one administrator
must remain in each group. Self-removal is forbidden: another administrator must do
it. Removing the last administrator fails `LAST_ADMINISTRATOR`; other self-removal
fails `SYSTEM_EVENT_INVALID`. Unchanged sets fail `SYSTEM_NO_CHANGE`.

Application entries require historical write in their selected audience, plus the
model's required capabilities there. Later grants never authorize an earlier signer.
Admission and re-admission deliver every historical key of that group. Removal rotates
only its future key; existing historical keys and plaintext remain readable. Current
membership controls authoring, not suppression of decryptable history. Removing a
member from `document` changes no other group's membership, keys or rights.

Group labels/descriptions belong in encrypted application events. Public group IDs,
signers, membership/capability changes, wrap targets, epochs/recipients, linkage,
counts/sizes and signed commit metadata remain observable. This profile does not
hide membership or traffic patterns. Other recipients' decryptability is always
reported as `unverified`.

## Keys and contextual binding

Each group epoch uses a fresh clamped 32-byte X25519 scalar and its age recipient.
Generate 32 random bytes, clamp as X25519 and encode B(bytes). These are audience
keys, not additional identities. Private scalars never appear in public JSON.
On creation or rotation, reject a recipient already recorded in any audience/epoch.
This detects declared key reuse, not an authorized author disclosing a secret.

A wrap is a binary age file encrypted to one member's derived identity recipient.
Its canonical plaintext is:

```ts
type KeyPlaintext = {
  context: "concord.audience-key/1";
  parent: CommitId | null;
  nonce: Nonce;
  audience: AudienceId;
  epoch: number;
  identityId: string;
  recipient: string;
  secret: string; // B(clamped 32-byte scalar)
};
type Wrap = { identityId: string; ciphertext: string };
type HistoricalWrap = { epoch: number; ciphertext: string };
```

Every addressed wrap must decrypt and match canonical bytes, all context fields,
scalar clamping and the declared recipient derived from that scalar. A malformed
addressed wrap fails `KEY_WRAP_INVALID`, even if a later admission supplies a valid
replacement. Other recipients' encrypted contents cannot be verified by this host.

Each application entry encrypts canonical [event plaintext](alpha-protocol.md) once
to the selected group's current epoch recipient, with fresh age file material. Check
parent, nonce, model, audience and epoch on decryption. An available key with failed
authentication/context is invalid, not locked. Cryptography stays in Identity/Armour;
Armour uses typage's `age-encryption` implementation, with no WASM initialization.

## Closed system events

Every event is `{ type, version: 1, data }`. All data shapes below are closed.
Wrap arrays sort by identity ID using ASCII order; historical wraps sort by increasing
epoch. Every referenced identity must validate. Duplicate, omitted and extra elements
fail. Unknown event type/version yields `UNSUPPORTED_SYSTEM_EVENT`, never a no-op.

```ts
// system.init: only entry in genesis, owner equals containing commit signer.
type InitData = {
  audience: "document";
  epoch: 0;
  recipient: string;
  owner: PublicIdentity;
  wraps: [Wrap]; // exactly the owner
};
// system.group.create: actor has document.write; new ID, fresh key, epoch zero.
type GroupCreateData = {
  audience: GroupId;
  epoch: 0;
  recipient: string;
  wraps: [Wrap]; // exactly the containing commit signer
};
// system.member.set: audience exists; authority is checked in that audience.
type MemberSetData = {
  audience: AudienceId;
  identity: PublicIdentity;
  capabilities: Capability[];
  history: HistoricalWrap[];
};
// system.member.remove: active target, authorized administrator, fresh rotation.
type MemberRemoveData = {
  audience: AudienceId;
  identityId: string;
  epoch: number; // selected group's previous epoch + 1
  recipient: string;
  wraps: Wrap[]; // exactly the selected group's remaining active members
};
```

New/re-admitted members receive exactly one wrap for every epoch of their selected
group. Existing members' capability changes have empty history. Admission does not
rotate. Authoring without any required historical secret fails
`HISTORICAL_KEY_UNAVAILABLE` atomically. Removal wraps the fresh epoch to every
remaining member, sorted by ID, and no removed member. Other groups are untouched.
Later entries of the same commit observe updated authority and epoch.

No group deletion, public label fields, generic rotate event, role/account registry,
anonymous envelope or implicit cross-group privilege exists in profile 1.

## Two-stage replay and coverage

Protocol verification checks every reachable record before resolving exact model and
profile implementations from the host. No document-provided code is loaded.

Stage A first validates the entire public authority history: group creation,
membership, epoch and historical signer write for every application envelope. It
records immutable per-entry facts. No decryption or model callback runs until the
complete public pass succeeds, including groups hidden from the reader.

Then validate every wrap addressed to the reader across the selected history,
including grants before removal and later historical admissions. Decrypt each
application entry whose audience/epoch key is available. Return exactly one readable
entry or locked marker per application entry in order. No reader means no unwrap
attempts and all application entries locked. Retained old keys remain usable after
removal; unavailable future epochs stay locked. Never trial-decrypt unrelated keys.

Stage B replays the whole resulting stream. A model without `reduceLocked` requires
all events; any locked entry returns locked inspection before even `initial` runs.
Without a reader this full model also returns locked inspection for private genesis.
A model with `reduceLocked` explicitly decides what public locked markers mean in
its own state. The hook gets no fabricated event payload, reader identity or secrets.
Any hook/reducer/validation/requirement failure aborts the entire projection.

Successful ready state and `replay()` carry `coverage: "complete"` for zero locked
entries, otherwise `"readable"`, and the exact `lockedEntries` count. Inspection's
application status is respectively `valid` or `scoped`. Scoped success validates
readable semantics only; it does not certify hidden event types, model requirements
or transitions. `canWrite` means the supplied signer has write in at least one group;
each command still checks its selected audience independently.

After a successful complete system pass, inspection exposes immutable `entries` and
`audiences`, even if later model replay fails. They are null if no complete system
result exists. Failed replay never exposes a trusted intermediate projection.

## Public system seam

`@ternent/concord/system` exports `createStandardSystemProfile`, `createGroup`,
`setMember`, `removeMember` and specialist types. Member helpers default to
`document` only when audience is omitted; null or invalid IDs fail. Callers never
supply actor, key, epoch, recipient or ciphertext. Group creation returns the generated
ID with its receipt only on successful publication.

```ts
type ReplayItem =
  | { status: "readable"; entryId: EntryId; event: DomainEvent; facts: SystemFacts }
  | { status: "locked"; entryId: EntryId; audience: AudienceId; epoch: number; facts: SystemFacts };
type AudienceState = {
  audience: AudienceId;
  members: readonly Member[];
  epochs: readonly { epoch: number; recipient: string }[];
};
type SystemReplay = {
  entryFacts: readonly { entryId: EntryId; facts: SystemFacts }[];
  entries: readonly ReplayItem[];
  audiences: readonly AudienceState[]; // sorted by audience ID
  reader: PublicIdentity | null;
  session: object; // opaque; keys stay in profile-private WeakMap
};
type ApplicationIntent = {
  kind: "application";
  event: DomainEvent;
  required: readonly Capability[];
  audience: AudienceId;
};
type SystemIntent =
  | { kind: "group.create"; audience: GroupId }
  | {
      kind: "member.set";
      audience: AudienceId;
      identity: PublicIdentity;
      capabilities: readonly Capability[];
    }
  | { kind: "member.remove"; audience: AudienceId; identityId: string };
```

`SystemProfile` has bootstrap, replay and prepare, using runtime-branded verified
history. Bootstrap owns the init nonce/key/wrap. Prepare generates entry nonces,
wraps and ciphertext through Identity/Armour. The runtime owns the signed commit,
checks total ordered entry coverage and signer/audience binding, and verifies/replays
the complete candidate before atomically publishing bytes, state and report.
Sessions are not serializable and never expose key material. Values crossing the
seam are immutable. Custom profiles are trusted host code with explicit versioned
semantics, not untrusted plugins supplied by a document.

Commands validate input, select one audience with `commands[name].audience` (default
`document`), check write there, then decide with that group's current signer facts.
Every emitted event must select that same audience using the model's `audience`
hook (default `document`). Replay checks event selection against its signed envelope.
Mixed-audience commands fail before encryption/signing. Draft mode now groups
several commands across audiences into one atomic commit; each command retains this
single-audience rule. System management requires an immediate-mode handle.

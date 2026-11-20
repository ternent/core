# Independent groups and readable replay

Status: B01 design draft, 2026-11-20. Independent membership is accepted in
[ADR 0015](../adr/0015-keep-audience-memberships-independent.md). Schemas and
interfaces below are the proposed implementation contract for B03/B04, not current
exports or tested multi-group behavior. The current implementation remains the
single-audience [standard profile](standard-profile.md).

## 1. Scope and evidence

Keep one signed document and one bounded application model. System extensions own
group authority, key distribution and decryption; models own application meaning.
Identity/Armour continue to own the cryptography. No new package, global membership
layer, transport, merge, anonymous envelope or trial-decryption routing is needed.

The relevant existing code is `packages/concord/src/system/{standard,membership,
audience,authoring}.ts`, `src/{runtime,model/types,protocol/types}.ts`, and the
legacy behavior in `packages/workspace/src/{plugins/permissions,runtime/privacy}.ts`.
The latter creates independent group keys and encrypted grants but does not rotate
on removal. Reuse the current standard profile's stronger validation/rotation rules.

### Accepted behavior

- `document` is the default group. Each additional group has independent authority
  and keys. Membership in the default group is not required to join another group.
- Default-group writers may create groups without approval. Document ownership
  gives no automatic access or administration in those groups.
- Admission and re-admission give full group history. Removal rotates only that
  group's future key. Retained historical access remains readable.
- System replay completes before model replay. Raw readable content must be
  accessible; locked markers do not certify hidden application semantics.
- Signed-history integrity, signer binding, atomic publication, read-only handles,
  deterministic replay and explicit divergence remain mandatory.

### Proposed implementation choices

Reuse the existing four capabilities and membership rules per audience. Keep group
titles/descriptions in encrypted application events rather than adding system
profile policy. Add an explicit model hook for locked entries; models that require
all events continue to return locked inspection when any event is unavailable.

This is a pre-release revision of the intended v1 contract. No old/new runtime
compatibility layer is requested. Proposed authoring still declares
`{ id: "concord.standard", version: 1 }` and uses the existing suite/container/hash
domains. Before implementation, revise the normative profile/protocol/model docs
together. Existing fixed single-audience vectors remain unchanged where their
bytes still satisfy the revised contract; do not regenerate them just to pass.
Old executables need not understand new groups; no interoperability claim is made.

## 2. Audience identifiers and authority

```ts
type GroupId = `group:${string}`; // "group:" + B(16 CSPRNG bytes)
type AudienceId = "document" | GroupId;
type Capability = "read" | "write" | "grant" | "administer";
```

Group identifiers are opaque public routing values with canonical base64url suffixes
of exactly 16 decoded bytes. They carry no label, identity or policy. IDs cannot be
reused within a document. Epochs start at zero independently for each audience.

| Operation                    | Required authority immediately before the entry                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------- |
| Create independent group     | `write` in `document`; creator receives all four capabilities in the new group              |
| Author application event     | `write` in the selected audience plus its model-required capabilities                       |
| Set member                   | `administer` in that audience, or its existing bounded `grant` rule                         |
| Remove member                | `administer` in that audience; existing target and another administrator must remain        |
| Inspect historical plaintext | Possession of the matching historical key; current membership is not a confidentiality gate |

Every active member has `read`; capability arrays remain unique in the order read,
write, grant, administer. As today, a grant holder can give a subset of read/write
they hold, and cannot change a target with grant/administer. Administrators can set
any nonempty set including read. Unchanged sets fail `SYSTEM_NO_CHANGE`.

Apply final-administrator protection separately to each audience. Retain the current
self-removal prohibition; another administrator performs removal. There is no group
deletion, implicit ownership transfer, cross-group privilege inheritance or global
revocation operation. Last-administrator demotion/removal fails `LAST_ADMINISTRATOR`;
non-final self-removal fails `SYSTEM_EVENT_INVALID`.

An Accounts editor can still write Accounts after removal from `document`. They
cannot create another group unless they again have default-group write. Granting
someone default-group administer never grants them authority over Accounts.

## 3. Minimal wire changes

Canonical values/encodings, unsigned commit subjects, signatures, chain structure
and one selected head are unchanged. Generalize only the audience routing fields
and the closed system event data needed for independent membership.

```ts
type ProtectedEvent = {
  audience: AudienceId;
  epoch: number;
  ciphertext: string; // B(binary age), encrypted once to this audience/epoch
};
type Wrap = { identityId: string; ciphertext: string };
type HistoricalWrap = { epoch: number; ciphertext: string };

// Existing genesis event; exact existing shape retained.
type InitData = {
  audience: "document";
  epoch: 0;
  recipient: string;
  owner: PublicIdentity;
  wraps: [Wrap];
};
type GroupCreateData = {
  audience: GroupId;
  epoch: 0;
  recipient: string;
  wraps: [Wrap]; // only the creator, bound to the containing commit signer
};
type MemberSetData = {
  audience: AudienceId;
  identity: PublicIdentity;
  capabilities: Capability[];
  history: HistoricalWrap[];
};
type MemberRemoveData = {
  audience: AudienceId;
  identityId: string;
  epoch: number; // selected audience's prior epoch + 1
  recipient: string;
  wraps: Wrap[]; // exactly this audience's remaining active members
};
```

Events are `system.init`, `system.group.create`, `system.member.set`, and
`system.member.remove`, each with event version 1. All shapes are closed. Unknown
events remain unsupported, never ignored. Group creation after genesis requires a
new GroupId, epoch zero, a fresh recipient and exactly one creator wrap. No group
creation or application entry may share genesis with `system.init`.

Membership operations must name an existing audience. For admission/re-admission,
`history` has exactly one wrap for every epoch of that audience, in increasing order.
For an existing member's capability change, it is empty. An author missing any
required historical secret fails `HISTORICAL_KEY_UNAVAILABLE` before publication.

Removal generates a fresh epoch key and wraps it to exactly the remaining members
of that audience, sorted by identity ID. On creation or rotation, reject a recipient
already recorded for any audience/epoch in the document. This detects declared key
reuse across groups; it cannot prove an authorized author kept secrets confidential.
Other audiences and their epochs/wraps are untouched.
Later entries in the same commit observe the changed authority and epoch.

The key-wrap plaintext retains `context: "concord.audience-key/1"`, parent, nonce,
epoch, identityId, recipient and secret, with `audience: AudienceId`. The application
plaintext likewise retains `context: "concord.application/1"`, parent, nonce, model,
epoch and event, with `audience: AudienceId`. Decryption checks exact canonical bytes
and every context field against the actual envelope. Cross-group ciphertext/wrap
substitution must fail even when a host can decrypt both groups.

### Public metadata and privacy

Audience IDs, group creation, signers, membership/capability changes, grant target
identities, epochs/recipients, linkage, sizes/counts and signed commit metadata stay
public so any host can validate the complete authority transitions without keys.
The identifiers link activity within a group; this design does not hide membership
or traffic patterns. Other recipients' wraps remain decryptability-unverified.

Group labels/descriptions belong to the application model and are encrypted to the
chosen group like any other event. There is no public label field or plaintext
fallback. Ciphertext and public metadata remain inspectable by every holder of the
document. Any model exposing a label outside its group does so deliberately.

## 4. System replay and truthful coverage

### Stage A: public authority, then decryption

1. Verify all reachable protocol history and apply any external freshness anchor.
2. Scan every entry in order, checking group transitions and application outer
   audience existence, current epoch and historical signer write authority. Group
   creation checks the actor's default-group authority at that position.
3. Record immutable per-entry facts. For an application entry these are its actor,
   selected audience, and that actor's capabilities/membership in that audience at
   the original entry position. Later grants never retroactively authorize a signer.
4. Process all wraps addressed to the supplied reader across selected history,
   including later historical grants and grants made before removal. Validate every
   addressed wrap, including repeated admissions. Private keys remain system-private.
5. For every application entry, return exactly one readable event or locked marker
   in the same order. With a matching key, authentication/context failure is invalid.
   Without the key, mark locked; do not try unrelated keys or treat ciphertext as an
   empty event. A missing reader produces locked markers without decryption attempts.

No current-membership check suppresses historical plaintext that can be decrypted.
Current capabilities still control authoring. A removed member opening a later head
can read old events and see new-epoch events as locked. A later re-admission can
unlock those saved events; it does not alter the old history.

The runtime validates a total ordered partition of the exact expected application
entry IDs. A profile cannot omit, duplicate, reorder, substitute or invent entries,
misbind actor/audience facts, or return secrets. Public system validation succeeds
for all groups before any model callback, including groups the reader cannot decrypt.

### Stage B: complete pass over the available stream

```ts
type SystemFacts = {
  actor: PublicIdentity;
  audience: AudienceId;
  capabilities: readonly Capability[]; // actor in this audience at this position
  members: readonly Member[]; // this audience at this position
};
type ReplayItem =
  | { status: "readable"; entryId: EntryId; event: DomainEvent; facts: SystemFacts }
  | { status: "locked"; entryId: EntryId; audience: AudienceId; epoch: number; facts: SystemFacts };
type LockedEvent = { audience: AudienceId; epoch: number };
// Proposed replacement for the current document-only replay output:
type SystemReplay = {
  entryFacts: readonly { entryId: EntryId; facts: SystemFacts }[];
  entries: readonly ReplayItem[]; // exhaustive application entries, in order
  audiences: readonly {
    audience: AudienceId;
    members: readonly Member[];
    epochs: readonly { epoch: number; recipient: string }[];
  }[];
  reader: PublicIdentity | null;
  session: object; // opaque; secrets remain private to the system implementation
};
```

Proposed model additions:

```ts
// On each command definition, after input validation and before decide():
audience?(input: CommandInput): AudienceId; // absent means "document"
// On the model, checked on both authored and replayed readable events:
audience?(event: E): AudienceId; // absent means the default "document"
reduceLocked?(state: Readonly<S>, entry: LockedEvent,
              facts: SystemFacts): Result<S, ModelIssue>;
```

The existing readable-event validate/requirements/reduce path remains. Audience
selection is pure model behavior. A command validates its input, selects one existing
audience, checks current write there, and receives that audience's signer facts in
its decision context. Every emitted event must select the same audience. On replay,
the validated event's selection must equal its public envelope audience. Unknown/
noncanonical selections or inconsistent emitted-event routing fail before authoring;
they never cause implicit group creation or plaintext downgrade.

This resolves the otherwise circular need to decide events before discovering which
audience's permission facts to pass into the decision. A single command does not
span audiences in this draft; explicit draft mode may group several commands from
different audiences into one atomic commit. Cross-group domain operations must be
modeled explicitly rather than treated as a runtime migration or permission bypass.
Sam accepted one audience per command on 2026-11-20; see
[ADR 0016](../adr/0016-route-each-command-to-one-audience.md). Moving an item between
groups uses several commands in an explicit draft commit. This routing rule and
independent membership are accepted; the remaining interface details are the draft
implementation contract.

An absent `reduceLocked` means the model requires every event. If any entry is locked,
return locked inspection before invoking initial/reducer callbacks. An explicit hook
opts into readable replay and runs once for every locked entry in its original
position. The hook has public facts and the marker, never a fabricated event payload,
reader identity, mutable security map or key. IDs/provenance remain in inspection.

The model owns cross-group dependencies: it can retain a placeholder, defer a
relationship in its projection, or reject the transition. Runtime does not infer an
application-specific repair or silently ignore a missing target. A hook exception,
invalid result/state or readable-event/model failure aborts the entire pass. Publish
snapshot, projection, inspection and coverage together only after success.

Proposed public result additions:

```ts
// Required on every ready state; replay() returns this metadata with projection.
type ReplayCoverage = { coverage: "complete" | "readable"; lockedEntries: number };
type ProjectionResult<S> = ReplayCoverage & { projection: Readonly<S> };
// ReadyState<S> includes ReplayCoverage alongside head/projection/canWrite.
// InspectionReport.application gains "scoped" for successful readable coverage.
```

`complete` requires zero locked entries; otherwise a successful model pass is
`readable` and application status `scoped`. The same coverage must accompany both
`state()` and `replay()`; there is no bare replay result that implies full coverage.
Integrity `valid` covers complete signed history, while `scoped` does not certify
hidden event data, event types, model-required capabilities or hidden transitions.
An unknown reader with an opted-in model may therefore receive a completely locked,
read-only view; the ordinary full-replay model still receives locked inspection.

Inspection remains available for raw readable evidence after failure, but must not
label a failed or incomplete model pass as trusted projection. No new universal
raw-decryption/export format is introduced in this design.

Concretely, propose `InspectionReport.entries: readonly ReplayItem[] | null`:
populate it only after the full system pass succeeds, retain it if the later model
pass fails, and return immutable copies. `null` means a complete system-evaluated
entry stream is unavailable. Entry evidence is distinct from projection and from
sanitized error `details`; do not place plaintext in error messages. Raw failed
protocol/system artifacts remain exportable inspection evidence without certifying
their contents. This lets consumers expose successfully decrypted content even
when they cannot produce an application projection.

## 5. Authoring interface and failure behavior

Proposed `/system` operations:

```ts
createGroup(handle): Promise<Result<CommitReceipt & { audience: GroupId }>>;
setMember(handle, { audience, identity, capabilities }): Promise<Result<CommitReceipt>>;
removeMember(handle, { audience, identityId }): Promise<Result<CommitReceipt>>;
```

No actor, raw key, epoch, recipient or ciphertext comes from callers. Group creation
generates its ID/key internally and returns the ID only on success. Application
commands still dispatch through the model; individual emitted events may choose
their command's selected audience only. A grouped commit can contain commands for
different audiences only when the author has the required rights in each.

Keep immediate system authoring and the existing draft guards. One operation is one
verified/replayed commit. Failed validation/encryption/signing/replay retains the
previous head, bytes, projection and draft. App commands on a readable view are
permitted only after a successful model pass; the model decides whether visible
state is sufficient, and normal scoped capability checks still apply. Nothing
certifies hidden whole-document model invariants on such a view.

`canWrite` means a signer has current write and the current epoch key in at least
one audience, not permission for every command/group. System administration checks
its own privileges, including administer without write, as in the existing profile.
A signer-free handle always rejects mutations. Inspection-only handles cannot author.

Reuse the current error vocabulary: unsupported event/version →
`UNSUPPORTED_SYSTEM_EVENT`; unknown audience, duplicate group, invalid epoch/wrap
sets → `SYSTEM_EVENT_INVALID`; missing authority → `CAPABILITY_DENIED`; absent
historical author key → `HISTORICAL_KEY_UNAVAILABLE`; malformed addressed wrap →
`KEY_WRAP_INVALID`; available-key authentication failure → `DECRYPTION_INVALID`;
decrypted audience/context mismatch → `EVENT_CONTEXT_INVALID`. A model audience
selection that disagrees with a readable envelope is `EVENT_INVALID`.

For public transition errors retain the existing precedence: schema/encoding,
actor authority, target existence, no-op, last administrator, self-removal, epoch/
wrap-set invariants. Never downgrade an invalid addressed wrap or an available-key
decryption failure to locked. Missing keys are locked coverage rather than proof of
an invalid author; `KEY_UNAVAILABLE`/`READ_ACCESS_REQUIRED` still produce locked
inspection where the model requires complete coverage.

## 6. Concrete scenario and acceptance matrix

[The saved semantic scenario](examples/independent-groups.json) uses symbolic
identities and labels for readability. It is an operation/expectation plan, not a
signed document, runnable test, ciphertext fixture or independent crypto vector.
Implementation tests must materialize entries once and reopen those exact bytes.

| ID  | Input/action                                                                      | Observable result                                                                                                         |
| --- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| G01 | Default writer Alice creates Accounts and Personal                                | Two independent audiences/keys; creator administers both; default owner receives neither key automatically                |
| G02 | Bob joins Accounts without default-group membership                               | Complete Accounts history, default/Personal locked; no default write or group creation privilege                          |
| G03 | Default owner attempts self-grant into Accounts                                   | `CAPABILITY_DENIED`; identical prior head/export/projection                                                               |
| G04 | Remove Alice from default while she edits Accounts                                | Default key rotates; Accounts unchanged; Accounts write succeeds and new group creation fails                             |
| G05 | Remove Accounts editor Bob                                                        | Only Accounts epoch advances; Bob retains prior plaintext/keys and cannot decrypt later Accounts content or write there   |
| G06 | Re-admit Bob after multiple Accounts epochs                                       | Every Accounts epoch is wrapped; exact saved history becomes readable, including the interval while absent                |
| G07 | Grant holder exceeds its subset or last administrator is removed/demoted          | Existing scoped authority/last-administrator errors; no partial mutation                                                  |
| G08 | Signed wrong/unknown group, old epoch, wrong recipient set or cross-group context | Public system failure or addressed-wrap/decryption/context failure in its owning stage                                    |
| G09 | Reader has Accounts key but lacks Personal                                        | One ordered readable/locked stream; opted-in model reports readable coverage; full model returns locked inspection        |
| G10 | Replay the same snapshot with the same capabilities twice                         | Identical projection, locked markers/count and coverage; fresh randomized authoring is not compared for equality          |
| G11 | Readable model event/hook rejects after earlier successful reductions             | No intermediate trusted projection or head; evidence remains inspectable/exportable                                       |
| G12 | Tamper, omit or reorder reachable committed content                               | Protocol fails before system/model callbacks; no trusted view, including scoped views                                     |
| G13 | Profile drops/duplicates/reorders a locked item or forges its facts               | Runtime rejects profile output; exact application-entry partition required                                                |
| G14 | Change a group label                                                              | Only encrypted application data changes; system envelope contains no title/description                                    |
| G15 | Forge write after revocation vs fork before revocation                            | Post-removal authority fails; valid older-parent fork remains divergent with no automatic merge                           |
| G16 | Corrupt another recipient's encrypted wrap                                        | Public structure can be valid; that recipient later fails on decryption; other hosts report its decryptability unverified |
| G17 | No reader, opted-in model vs full model                                           | All locked/readable-coverage read-only view vs locked inspection; neither exposes fabricated events                       |
| G18 | Group admin without write grants/removes vs app authoring                         | Scoped management allowed subject to admin rules; application write denied                                                |
| G19 | Route a command to Accounts, then emit an event routed to Personal                | Decision gets Accounts facts; mixed routing fails before encryption/signing and leaves the prior head unchanged           |

Tests for G08/G16 must separate ordinary byte tampering from deliberately re-signed
system-invalid fixtures. Fix expected outputs independently; do not compute an
expectation with the implementation under test. Preserve Node/browser/package import
checks and the fixed Identity/age/protocol vectors.

## 7. Cost model and implementation handoff

The default group introduces no outer encryption pass. Every application entry is
encrypted once to one explicitly named audience/epoch. On open, route by public
audience ID; unwrap only host-addressed records. Never trial every group key.

Group creation adds one key/creator wrap. Admission adds one wrap per historical
epoch of that group; removal adds one fresh epoch and a wrap per remaining member.
Open still verifies full history and decrypts readable entries; repeated membership
facts and full candidate replay can also dominate cost. These are operation counts,
not measured latency or a claim of linear total runtime. Measure history size, epoch
count, membership and reader coverage before introducing cache/incremental replay.

For B03 implement group transitions/authoring and their public negative cases. For
B04 implement the exhaustive readable/locked stream, model hook/coverage and atomic
publication checks. Update `standard-profile.md`, `alpha-protocol.md`, the blueprint,
conformance and public docs in the same migration so the new profile has one
normative definition. Keep this draft as design rationale, not a parallel runtime.

This B01 pass changes documentation/scenario data only. No group implementation,
behavior test, signed group vector, benchmark, package publication or remote CI run
is claimed. The earlier active-workspace baseline and its Chromium launch limitation
remain recorded in [the shipping inventory](../engineering/shipping-inventory-2026-11-20.md).

# Concord alpha implementation blueprint

Current container/ownership revision: [ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md)
and [the Ledger-backed profile](alpha-protocol.md) supersede the Concord-only wire,
signing domains and internal-Ledger ownership described in this earlier plan.
Ledger is a standalone public product. Concord delegates its history lifecycle;
UI and public Tooling are outside the five-product release.

Shipping update, 2026-11-20: independent memberships, scoped command routing and
readable/locked replay are implemented. [ADR 0015](../adr/0015-keep-audience-memberships-independent.md)
and [ADR 0016](../adr/0016-route-each-command-to-one-audience.md) record the decisions.
The [standard profile](standard-profile.md) defines their wire and replay contract.
Draft authoring is implemented in B05; the reusable storage conflict proof is implemented by B12.

Status: first-slice contract, 2026-10-21. Identity, Armour and the private immediate
commit/register slice are implemented; [migration evidence](../engineering/alpha-first-slice.md)
records the retained lifecycle and ownership. The former local handshake is retired;
public library consumers preserve its applicable lifecycle/storage checks. Drafts and the reusable storage proof are implemented. The
[accepted architecture](alpha-architecture.md) and ADRs 0001–0005 remain in force.
New decisions are recorded in ADRs 0006–0009. No legacy compatibility is implied.

Start with this path:

```text
create -> dispatch/commit -> export -> open -> verify -> replay -> inspect
```

`open` already verifies and replays; the explicit verify/replay calls demonstrate
independent verification and repeatability rather than required extra loading steps.
The normative details are split by ownership:

| Contract                                                       | Source                                                                              |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Signed wire schema, canonical bytes, IDs, signatures, ancestry | [Protocol 1](alpha-protocol.md)                                                     |
| Bootstrap, authorization, group keys, two-stage system replay  | [Standard profile 1](standard-profile.md)                                           |
| Fixed artifacts and observable success/failure checks          | [Conformance](conformance.md) and [vectors](vectors/README.md)                      |
| Runtime, typed models, module ownership, delivery              | This blueprint                                                                      |
| Published artifact and feedback gates                          | [Repository acceptance](../engineering/repository-hygiene.md#acceptance-boundaries) |

If an implementation requires a new wire field or new security interpretation,
change these documents and vectors deliberately before coding that behavior. Package
versions and the wire/model/profile versions are separate numbers.

## 1. First slice and exact model

The first application is a register, not yet the board. It exercises every lifecycle
seam without task policy. Its ref is `{ id: "concord.example.register", version: 1 }`.
Initial projection is `{ value: "" }`. Its only command `set` accepts exactly
`{ value: string }`, with value at most 4096 UTF-8 bytes (empty is allowed). Unknown
fields and invalid Unicode fail `COMMAND_INVALID`. It emits exactly one event
`{ type: "value.set", version: 1, data: { value } }`. Event validation uses the same
closed data shape and bound; unknown type/version gives `EVENT_UNSUPPORTED`.
The reducer replaces value; the model requires write and audience `document`.
Setting the same value still emits an event and commits; no hidden deduplication.

Create selects the standard profile and this model, generates a fresh epoch-0 key,
and signs a genesis containing only `system.init`. The resulting projection is the
model initial state. The first set creates one application entry and a child commit.
Export transfers committed history only. Open with the same identity capability
must reproduce the value. Open without a reader returns locked inspection, even
if there are no application entries yet. Open with a decrypt-only capability returns
ready but read-only. No storage, framework, clock, network, or UI is required.

The first consumer fixture should read like this; `registerModel` is the exact model
above, supplied by `/testing`, not application logic bundled into the runtime entry:

```ts
import { createDocument, openDocument } from "@ternent/concord";
import { createStandardSystemProfile } from "@ternent/concord/system";
import { registerModel } from "@ternent/concord/testing";
import { generateIdentity } from "@ternent/armour";

const identityResult = await generateIdentity();
if (!identityResult.ok) throw new Error(identityResult.error.message);
const identity = identityResult.value;
const system = createStandardSystemProfile();
const created = await createDocument({ model: registerModel, system, identity });
if (!created.ok) throw new Error(created.error.message);
const handle = created.value;
const committed = await handle.dispatch("set", { value: "hello Concord" });
if (!committed.ok) throw new Error(committed.error.message);
const bytes = handle.export();
const reopened = await openDocument({ bytes, model: registerModel, system, signer: identity });
const report = await reopened.verify();
const replayed = await reopened.replay();
const inspection = reopened.inspect();
// Assert report.integrity === "valid", replayed value and committed head;
// assert inspection has no findings. Use the conformance cases for failure paths.
```

## 2. Application-facing interface

New interfaces replace the legacy `createConcordApp` surface in the clean alpha;
do not layer another runtime around Workspace. Code here is the target TypeScript
contract. Wire structures are defined in the protocol; their public types are
re-exported where callers need them.

```ts
type Result<T, E = ConcordError> = { ok: true; value: T } | { ok: false; error: E };
type ConcordError = {
  code: ErrorCode; // closed union in conformance.md
  phase: "input" | "protocol" | "requirements" | "system" | "model" | "author" | "storage";
  message: string; // explanatory, not a stable assertion target
  path?: string; // JSON pointer into input; stable when a record exists
  commitId?: CommitId;
  entryId?: EntryId;
  details?: Readonly<JsonObject>; // never keys, decrypted data, or secrets
};
type ReplayCoverage = { coverage: "complete" | "readable"; lockedEntries: number };
type ProjectionResult<S> = ReplayCoverage & { projection: Readonly<S> };
type ReadyState<S> = ReplayCoverage & {
  status: "ready";
  documentId: CommitId;
  head: CommitId;
  projection: Readonly<S>;
  canWrite: boolean;
};
type InspectionState = {
  status: "inspection";
  reason: "invalid" | "locked" | "incompatible" | "freshness";
};
type CommitReceipt = { status: "committed"; head: CommitId; entryIds: readonly EntryId[] };
type DraftReceipt = { status: "staged"; baseHead: CommitId; entryCount: number };
type DraftState<S> = { baseHead: CommitId; entryCount: number; preview: Readonly<S> };

interface DocumentHandle<S, Commands extends Record<string, Json>> {
  state(): ReadyState<S> | InspectionState;
  dispatch<K extends keyof Commands & string>(
    command: K,
    input: Commands[K],
  ): Promise<Result<CommitReceipt | DraftReceipt>>;
  commit(metadata?: JsonObject): Promise<Result<CommitReceipt>>;
  discardDraft(): Promise<Result<void>>;
  draft(): DraftState<S> | null;
  export(): Uint8Array;
  verify(): Promise<VerificationReport>;
  replay(): Promise<Result<ProjectionResult<S>>>;
  inspect(): InspectionReport;
}
```

Factories at `@ternent/concord`:

```ts
declare function createDocument<S, C extends Record<string, Json>, E extends DomainEvent>(options: {
  model: ApplicationModel<S, C, E>;
  system: SystemProfile;
  identity: IdentityCapability;
  mode?: "immediate" | "draft"; // immediate by default
  limits?: Partial<Limits>;
}): Promise<Result<DocumentHandle<S, C>>>;

declare function openDocument<S, C extends Record<string, Json>, E extends DomainEvent>(options: {
  bytes: Uint8Array;
  model?: ApplicationModel<S, C, E>;
  system?: SystemProfile;
  reader?: ReaderCapability;
  signer?: IdentityCapability;
  mode?: "immediate" | "draft";
  anchor?: Uint8Array; // previously verified full snapshot
  limits?: Partial<Limits>;
}): Promise<DocumentHandle<S, C>>;
```

`Limits` has integer fields `maxBytes`, `maxCommits`, `maxEntries`,
`maxCiphertextBytes`, `maxDepth`, and `maxMetadataBytes`, with the defaults in
Protocol 1. Values must be positive safe integers; invalid overrides are host
configuration errors. `maxBytes` bounds export as well as import; limits apply to
every authored candidate before signing. A byte limit failure leaves drafts intact.
Protocol verification checks both transport and canonical snapshot lengths before
extension execution, so expanding accepted numeric notation cannot create an
over-budget ready export.

At host seams, JSON/depth/byte validation applies to each logical value: command
input, event, projection, per-entry system result, and each system summary. Entry
and event counts must match verified history. Do not apply the snapshot byte budget
to a combined serialization of all replay facts: repeated facts expand with history.
A replay resource limit marks the affected stage unsupported and returns incompatible
inspection; it does not invalidate the signed history.

`Json`, `JsonObject`, public wire types, Result, ConcordError, and the lifecycle/model
types are exported from the root when mentioned in its declarations. `/protocol`
also exports Json/wire/report types, canonicalize, hashEntrySubject, hashCommitSubject,
verifyDocument, and compareSnapshots. Canonicalize and hash helpers return Result;
the verifier returns its report, and comparison returns Result of the five relations.
Hash helpers compute IDs only; commit signing is runtime-owned. `defineModel` is at
root. `createStandardSystemProfile()` is at `/system`, takes no required arguments,
and returns the official implementation described by standard-profile.md.

```ts
declare function canonicalize(value: unknown): Result<Uint8Array>;
declare function hashEntrySubject(subject: EntrySubject): Result<EntryId>;
declare function hashCommitSubject(subject: CommitSubject): Result<CommitId>;
declare function verifyDocument(
  bytes: Uint8Array,
  options?: {
    limits?: Partial<Limits>;
  },
): Promise<VerificationReport>;
declare function compareSnapshots(
  a: Uint8Array,
  b: Uint8Array,
  options?: {
    limits?: Partial<Limits>;
  },
): Promise<Result<"equal" | "ahead" | "behind" | "diverged" | "unrelated">>;
```

Canonicalize validates the value domain; hash helpers additionally validate the exact
known subject shape, without verifying a signature or resolving an entry reference.
Invalid verifier limit configuration gives an unsupported report with HOST_CONFIGURATION;
it is not mislabeled as document tampering.

`/system` exports `setMember(handle, { identity, capabilities })` and
`removeMember(handle, { identityId })`, each generic over the handle model and returning
`Promise<Result<CommitReceipt>>`. They use the handle's active signer and private
serialized authoring port, with no caller-supplied actor, keys, epoch, or ciphertext.
The runtime owns their one-commit lifecycle. They require immediate mode, reject
nonempty drafts with DRAFT_PENDING, and reject an empty draft-mode handle with
HOST_CONFIGURATION (no implicit mode switch). These specialist management functions
and their draft guards are implemented. `createGroup` follows these same guards;
member operations accept an optional audience that defaults to `document`.

An untyped inspection overload of open returns `DocumentHandle<never, Record<never,
never>>`. Passing a model gives its inferred types even when open returns inspection;
the caller must narrow `state().status` before using projection. Freeze/copy input
bytes on entry. Missing profile/model implementations do not cause creation to guess:
create requires both and checks their refs before any key generation.

Signer defaults as reader when present; an explicitly supplied reader must identify
the same identity as signer or open returns incompatible `IDENTITY_MISMATCH`.
A supplied signer is not evidence of membership. No signer means all mutation methods
fail `READ_ONLY_RUNTIME`, including discardDraft. `canWrite` also requires ready,
active write, and complete key access. System operations check their own capabilities.
Inspection handles reject all mutations with `INSPECTION_ONLY` before checking signer.

Expected failures return Result or inspection, not exceptions. Constructors take typed
configuration; invalid executable host configuration returns `HOST_CONFIGURATION` at
create, or incompatible inspection at open. Unexpected extension exceptions are caught
as `MODEL_FAILED` or `SYSTEM_FAILED` without plaintext in errors. No global rejection
handler, dynamic code loader, or console-only failure channel. JS allocation failure
and process termination are outside the contract.

### Independent verification and inspection

`verifyDocument(bytes, { limits? })` at `/protocol` returns `VerificationReport` and
requires no identity, profile, model, Armour, or Seal. The report is:

```ts
type VerificationReport = {
  integrity: "valid" | "invalid" | "unsupported";
  documentId: CommitId | null;
  head: CommitId | null;
  checkedCommits: number;
  checkedEntries: number;
  findings: readonly ConcordError[];
};
type InspectionReport = {
  verification: VerificationReport;
  system: "valid" | "invalid" | "unsupported" | "not-run";
  application: "valid" | "scoped" | "invalid" | "unsupported" | "locked" | "not-run";
  freshness: "unanchored" | "equal" | "ahead" | "behind" | "diverged" | "unrelated";
  otherRecipientsDecryptability: "unverified";
  requirements: readonly { kind: "system" | "model"; ref: ModelRef }[];
  lockedEntries: number | null; // null if structure/profile could not be interpreted
  findings: readonly ConcordError[];
  history: readonly CommitRecord[]; // raw public envelopes; [] when unparseable
  entries: readonly ReplayItem[] | null; // only after complete system pass
  audiences: readonly AudienceState[] | null; // public group summaries
};
```

Verification counts only records successfully checked in each phase; an unsupported
suite leaves signature-checked commits at zero. A valid report counts all records.
Unknown requirements appear in `requirements` only when unavailable/mismatched, in
system-then-model order. Inspection merges findings in protocol, requirements,
freshness, system, model order. Protocol failure prevents later phases. Resolve
requirements before system execution; freshness failure also stops replay. A complete
system pass yields one readable entry or locked marker per application entry, including
retained historical access after removal. No reader yields locked application entries.
Missing keys count only entries using unavailable audience/epoch keys; available-key
cryptographic/context failure is invalid. Models without `reduceLocked` return locked
inspection before callbacks if any entry is unavailable (also for private genesis
without a reader). Opted-in models fold the complete readable/locked stream and report
`coverage: "readable"`, application `scoped`, when locked entries exist. Zero locked
entries gives complete/valid. Hidden application semantics remain unverified.
Inspection exposes entries/audiences after successful system replay even when model
replay fails, with no intermediate trusted projection. Other recipients' encrypted
wraps remain decryptability-unverified.

`handle.verify()` verifies committed bytes without replaying or upgrading readiness.
`handle.replay()` performs both complete stages against the fixed committed snapshot
and returns its fresh `{ projection, coverage, lockedEntries }`; it cannot bypass verification or replay a range.
Inspection stays read-only; supplying new keys/models means a fresh open.
`inspect()` never decrypts on demand or returns keys. Reports and history are detached
immutable views. Ready-state projection and draft previews must not allow external
mutation of internal state; copy/freeze at public and extension seams.
After bounded parsing and known-schema validation, public commit envelopes remain
available as untrusted inspection evidence even if hashes, linkage or signatures
fail. Keep them separate from verified input; they never authorize extension replay.
When parsing/schema validation cannot establish those envelopes, history is empty.

Ready export is canonical protocol JSON. Inspection export returns an exact copy of
the input bytes, including malformed input, so evidence can be retained. `verify` on
an inspection handle validates those same bytes. Re-exporting a ready document need
not preserve original whitespace or annotations formatting, but preserves all signed
subjects and ciphertext bytes. Export never adds a projection, draft, identity seed,
group scalar, or cached verification assertion to the document.

### Authoring and atomicity

All mutating calls on a handle are queued in invocation order; no two operations share
a mutable candidate. Reads during a pending operation see the last published snapshot.
Synchronous reentrant dispatch from model/system callbacks fails `HOST_CONFIGURATION`.
Asynchronous profiles MUST NOT dispatch into the same pending handle after an await;
that host contract violation is not automatically distinguishable from an independent
queued caller in this runtime. See [ADR 0014](../adr/0014-keep-async-profile-reentry-a-host-contract.md).
Async I/O remains internal to signing/encryption, not model decisions.

Immediate dispatch validates input, invokes the model decision on committed projection,
validates every event, checks model/system requirements, creates protected entries,
builds and signs one commit, protocol-verifies it, and completes two-stage replay of
the candidate. It atomically swaps committed snapshot, system facts, and projection
only after all steps succeed. Return its receipt. Multi-event decisions are one commit;
empty event lists fail `NO_EVENTS`. No implicit timestamp, ID, storage write, or retry
of a failed decision. Signing failure leaves the original head and projection intact.
The standard profile forbids self-removal, so authoring never needs a success path
that publishes an unreadable candidate. A different administrator may remove an actor.

Create follows the same candidate validation before returning a ready handle. Genesis
always commits immediately, even in draft mode. Creation failure returns no document.

Draft mode stages application intents in memory against an immutable base head, runs
their model transitions, and publishes only `draft().preview`. `state().projection`
remains committed. Subsequent decisions use the preview. Provisional previews are not
trusted committed reconstructions; no final entry IDs or ciphertext are promised.
`commit(metadata)` protects staged events using the current base, signs one commit,
verifies/replays, and atomically publishes it and clears the draft. Encryption happens
at commit time; on failure retain the full draft and original snapshot. Empty draft
fails `NO_DRAFT`. Explicit commit in immediate mode also fails `NO_DRAFT`; dispatch
already committed. `discardDraft()` discards the whole draft; empty draft is a no-op
success for a writable handle. Partial discard and mode switching are outside alpha.

The preview is provisional and carries the same reader scope as its committed base;
it cannot certify hidden application semantics. No protocol entry/commit IDs, nonces, ciphertext or
signature are allocated while staging. Staged event count includes committed entries
for `maxEntries`, and the prospective commit must fit `maxCommits`. Aggregate staged
intents and each preview are independently bounded by `maxBytes`/`maxDepth`. The
protected final snapshot may still exceed a byte/ciphertext limit at commit time;
that failure retains the draft. There is no estimate presented as a verified size.
Commit metadata is copied when `commit` is invoked, must be a JSON object within
`maxMetadataBytes`, and is checked before protection/signing. Omitted metadata is
signed as null. Invalid metadata fails `SCHEMA_INVALID`; bound failures use
`RESOURCE_LIMIT`. Signed metadata remains public.

Drafts are volatile. Export, verify, and full replay concern committed history and
leave staged intents unchanged. Reopening export discards any local draft by design;
no unsigned draft persistence is hidden in a storage adapter. System authoring is
immediate and is blocked by `DRAFT_PENDING` until an existing draft is committed or
discarded. Handle state never replaces another document via import/load; open creates
another handle. A failed candidate must leave the previous handle byte-for-byte
export-equivalent, with the same projection and draft.

## 3. Typed application models

The model interface has depth: callers define domain meaning while the runtime owns
entry envelopes, actor binding, security replay, encryption, and atomic publication.

```ts
type DomainEvent = { type: string; version: number; data: Json };
type ModelIssue = { code: string; message: string; path?: string };
type Capability = "read" | "write" | "grant" | "administer";
type SystemFacts = {
  actor: PublicIdentity;
  audience: AudienceId;
  capabilities: readonly Capability[]; // actor's rights at this entry position
  members: readonly { identity: PublicIdentity; capabilities: readonly Capability[] }[];
};
type DecisionContext = { facts: SystemFacts };
type ApplicationModel<S, C extends Record<string, Json>, E extends DomainEvent> = {
  ref: ModelRef;
  initial(): S;
  commands: {
    [K in keyof C]: {
      validate(input: unknown): Result<C[K], ModelIssue>;
      audience?(input: C[K]): AudienceId; // default document
      decide(
        input: C[K],
        state: Readonly<S>,
        ctx: DecisionContext,
      ): Result<readonly E[], ModelIssue>;
    };
  };
  validateEvent(input: unknown): Result<E, ModelIssue>;
  audience?(event: E): AudienceId; // default document
  requirements(event: E): readonly Capability[];
  reduce(state: Readonly<S>, event: E, facts: SystemFacts): Result<S, ModelIssue>;
  reduceLocked?(
    state: Readonly<S>,
    entry: { audience: AudienceId; epoch: number },
    facts: SystemFacts,
  ): Result<S, ModelIssue>;
};
```

`defineModel` is a typed identity/validation helper for this interface; it does not
register global state. Initial state, requirements, validations, decisions, and reducers
are synchronous pure functions. S MUST be Json. Typed input validation remains necessary
for JS/agent callers. Unknown command names return `COMMAND_UNSUPPORTED`; model issues
map to the phase's outer error code with `details.modelCode`, not arbitrary core codes.

Event type/version and data schemas are part of the model contract, fixed at its ref.
Commands are ephemeral authoring interfaces and are not replayed. Decisions must encode
time, randomness, IDs, and external observations in event data via validated inputs.
The host captures these before dispatch; the runtime does not inject ambient helpers
into reducers. Facts exclude current wall time, reader identity, mutable permission
maps, raw ciphertext, keys, and derived UI profiles. Requirement sets are checked on
authoring and historical replay. The runtime retains provenance (commit/entry IDs)
for inspection; the reducer cannot make state depend on the new commit ID.

After command input validation, select one audience and check current write there
before decide receives that group's signer facts. Every emitted event must select the
same audience. On replay event selection must match its signed envelope. Unknown or
inconsistent routing fails; no implicit group creation. Each selector is synchronous
and pure. Locked hooks get public facts/marker only; the model explicitly owns missing
cross-group dependencies. Rejecting any transition aborts the whole pass.

The model validates transitions in reduce as well as deciding commands: an authenticated
writer can produce a structurally valid event that violates model invariants. Such
history is integrity-valid and application-invalid, never a partially trusted board.
No upcasters, fallback model version, ignored unknown event, or mutable replay hooks.

## 4. Identity and primitive package interfaces

`@ternent/identity` owns raw-byte Ed25519 signing/verification, public identity checking,
strict point validation, seed derivation, and X25519/age conversion. The new capability
interface is:

```ts
// Capability types exported by Armour; PublicIdentity comes from Identity.
type PrimitiveError = { code: string; message: string };
type PrimitiveResult<T> = Result<T, PrimitiveError>;
type ReaderCapability = {
  publicIdentity: PublicIdentity;
  decryptAge(ciphertext: Uint8Array): Promise<PrimitiveResult<Uint8Array>>;
};
type IdentityCapability = ReaderCapability & {
  sign(message: Uint8Array): Promise<PrimitiveResult<Uint8Array>>; // exactly these bytes
};
// Convenience factories exported by Armour, delegating key derivation to Identity.
declare function identityFromSeed(seed: Uint8Array): Promise<PrimitiveResult<IdentityCapability>>;
declare function generateIdentity(): Promise<PrimitiveResult<IdentityCapability>>;
```

Identity owns the derived private key and MUST NOT depend on Armour to implement age.
Construct capabilities in two steps: Identity's base signer capability has
`publicIdentity`, `sign`, and `withX25519Secret(callback)` (a copied scalar scoped to the
async callback, zeroed in finally after callback settlement, never serialized);
Armour's `withAgeDecryption(base)` returns the above reader/signer capability by
composing its age implementation. Identity's factories are named `signerFromSeed`
and `generateSigner` and return BaseIdentityCapability. Identity also exports
`validatePublicIdentity(input)` and `verifySignature(publicIdentity, message, signature)`
with structured results and the protocol's strict point rules. The full identity
convenience factories above live at Armour. Concord consumes the resulting structural
types and does not construct or store private identity material. Identity exports
PublicIdentity and BaseIdentityCapability; Armour exports ReaderCapability and
IdentityCapability. The snippets use Result generically: primitive packages own their
error types, without importing ConcordError.

Armour additionally exposes `encryptAge({ recipients: readonly string[], plaintext:
Uint8Array }): Promise<Result<Uint8Array>>` and `decryptAgeWithSecret({ secret:
Uint8Array, ciphertext: Uint8Array }): Promise<Result<Uint8Array>>` for group-key use.
These operate on binary files and raw X25519 scalars/age recipients; no init/WASM step.
Its private engine must be pure TypeScript, satisfy the pinned age format, and pass
independent age CLI interop. Selecting the engine is an implementation/tooling choice,
not a new protocol choice. No production spawn of an age CLI. Primitive packages use
their own structured errors; Concord maps them to phase-specific codes without a
reverse dependency on Concord. Seed import and generation copy caller bytes.

Seal remains an independent artifact/proof module. Concord neither stores a Seal
proof on every entry nor makes protocol verification depend on Seal's manifest shape.
Both can consume Identity's raw signing primitives. No Seal changes or Action migration
are prerequisite to implementing this first slice.

## 5. Modules and packages

| Owner                      | Deep implementation behind its interface                                             | Must not own                                          |
| -------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------- |
| Concord `protocol/`        | Strict parser, canonicalization, IDs, commit verification, lineage comparison        | Model code, membership, decryption, storage           |
| Concord `runtime/`         | Lifecycle, serialized candidates, draft state, trust transitions, atomic publication | Domain commands, permission algorithms, age internals |
| Concord `system/standard/` | Bootstrap, historical authority, epochs, wraps, two-stage input preparation          | Board policy, profiles, persistence                   |
| Concord `model/`           | Types, model definition validation, deterministic fold runner                        | Application-specific schemas or reducers              |
| Identity                   | Key material, strict signature behavior, derived identities                          | Documents, age file implementation, accounts          |
| Armour                     | Pure TS age operations and composition with Identity                                 | Signed history, authority, application events         |
| Seal                       | Standalone artifact proofs                                                           | Concord lifecycle                                     |
| Example register / board   | Commands, event schemas, reducers, domain invariants                                 | Cryptographic envelopes or mutable system facts       |
| Storage adapter            | Whole artifact reads/writes and optional expected-head checks                        | Trust, repair, merges, projection persistence         |
| Tooling                    | Config profiles, graph orchestration, isolated artifact verification                 | Runtime dependencies                                  |

Only `@ternent/concord`, `/protocol`, `/system`, `/testing` are exported. Proposed
source entries are `src/index.ts`, `src/protocol/index.ts`, `src/system/index.ts`,
`src/testing/index.ts`. Public import filenames are `dist/index.js`,
`dist/protocol/index.js`, etc., with matching `.d.ts` and sourcemaps. `/protocol`
has no import path to runtime/system/Armour; inspect built dependency closure.
`/testing` exposes register fixtures, `assertModelConformance`, and a memory artifact
store, with no test runner in production dependencies. A conformance helper returns
structured assertions; it never auto-generates expected outputs from the implementation.

Runtime -> protocol, model runner, system interface. Standard system -> protocol,
Identity, Armour. Armour -> Identity. Identity -> reviewed crypto primitives.
Tooling has no runtime package dependencies. Framework/UI -> root Concord interface.
No new Ledger, Workspace, protocol-only package, storage framework, or universal plugin
package. Internal seams are private except the documented specialist subpaths.

Storage remains separate from the runtime. The minimal adapter and optional atomic
expected-head capability are implemented as reference helpers in `/testing`; see
[the storage boundary](storage-boundary.md) for exact types and limits. The basic
`createMemoryArtifactStore` stores copied raw bytes. The richer
`createMemoryExpectedHeadStore` advertises `expectedHead: true` and adds
`writeExpected(bytes, expected: CommitId | null)`. Null means create only if absent;
HEAD_CONFLICT returns copied remote bytes outside JSON error details. It serializes
all writes through validation/compare/replacement, so async verification cannot create
a read-then-write race within that shared instance. It verifies protocol history only
and uses default verifier limits; application validity still requires runtime open.

Failed publication never rolls back a local commit or erases a pending draft. Keep
both local and returned remote artifacts and compare explicitly. No automatic merge,
head selection, overwrite retry, draft persistence, transport or provider is added.
Expected head is not a byte revision or ancestry policy; freshness needs an external
anchor. Atomicity is limited to the reference instance. A production adapter must use
a real provider transaction/conditional write, not a non-atomic client read/write.

## 6. Toolchain and implementation order

The [repository guide](../engineering/repository-hygiene.md) defines the current
five-library workspace, ordinary shared Vite+/TypeScript base configs and standard
pnpm recursive builds. It supersedes the earlier portable-profile and app-driven
rollout. The [release contract and backlog](../engineering/release-and-deployment.md)
own candidate-registry verification, planning, publication and onboarding.

The implemented library sequence covers strict Identity/Armour primitives, the
Ledger-owned common container/lifecycle, Concord bootstrap and typed register,
independent membership/readable replay, in-memory drafts, external storage conflict
proof, and standalone Seal library/CLI. UI, portable tooling and the retired handshake
are not release gates. The deferred board below remains an application example,
not a required core package or hosted app.

ESM/ES2022 outputs are tested through installed Node 22/24/development-runtime
consumers and Chromium. Browser execution must exercise real cryptography; a syntax
target or successful bundle does not establish that result. Keep formatting, typed
lint, explicit types, behavior, builds and installed-artifact checks separate.
Use declared public workspace dependencies rather than source aliases or registry
predecessors. See [CONTRIBUTING.md](../../CONTRIBUTING.md) for current pins and commands.

## 7. Deferred project-board proof

Board ref: `{ id: "concord.example.project-board", version: 1 }`. It is example model
code above Concord. Use one document audience and grant history on admission. Initial
state is `{ title: "", columns: [], tasks: {} }`; board.configure must occur before
task commands. IDs are caller-supplied nonempty ASCII `[A-Za-z0-9_-]{1,64}`, unique
within their collection forever. Strings preserve Unicode; title/task title are 1–256
UTF-8 bytes, description 0–16,384. No model-generated time/randomness.

| Command -> event, all event version 1 | Exact payload and transition                                                                                                                                                            |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| configure -> board.configured         | `{ title, columns: { id, title }[] }`; once only, 1–32 unique columns, same title bound                                                                                                 |
| rename -> board.renamed               | `{ title }`; configured board required                                                                                                                                                  |
| createTask -> task.created            | `{ id, title, description, columnId }`; configured, new ID, existing column; append to column, assignee null, archived false                                                            |
| editTask -> task.edited               | `{ id, title, description }`; existing non-archived task; replace these fields                                                                                                          |
| moveTask -> task.moved                | `{ id, columnId, beforeId: string \| null }`; existing non-archived task and target column; remove first, insert before active task in target column or append; cannot reference itself |
| assignTask -> task.assigned           | `{ id, identityId: string \| null }`; existing non-archived task; target must be an active reader at event position, or null                                                            |
| archiveTask -> task.archived          | `{ id }`; existing non-archived task; remove from ordered column list, retain task content and last column ID, mark archived true                                                       |

Every task record holds id/title/description/columnId/assignee/archived; each column
holds id/title and an ordered task ID array. Configure's event columns gain empty
arrays in reduction. All commands and events use closed schemas and require write;
errors identify absent/duplicate/archived task, absent column, invalid before target,
absent assignee, and unconfigured/already configured board. Repeating archive fails.
No unarchive, column mutation, deletion, task permissions, automatic reassignment after
member removal, or attachments. Historic assignment remains as an identity reference
after removal. Display identity IDs or deterministic glyphs; directory/profile lookup
is optional UI work outside Concord. Future glyph design does not affect protocol.

The walkthrough creates/configures a private board; adds viewer and editor; proves the
viewer cannot write; edits/moves/assigns/archives as editor; groups commands with a
draft message; exports and reopens; admits another member with all historical keys;
removes the editor and rotates audience keys; rejects its write after removal; retains
its valid offline branch from before removal; rejects a routine stale publication
through expected-head write; and surfaces the two heads without merging or picking.
Tampered, missing-model, and locked imports remain exportable inspection artifacts.

## 8. Decisions, product questions, and observed evidence

There is no blocking product question for the first slice. Independent groups,
full history on admission, atomic complete or explicitly readable projections, and local volatile drafts
are explicit alpha constraints rather than prompts for an implementer to guess. A
product needing private task subsets or future-only membership needs a separately
specified profile/model; it must not quietly widen this alpha.

Networking, profiles/directories, consensus, merges, recovery, continuity, key rotation
of identities, checkpoints, partial authoritative replay, model upgrades, and
multi-document queries remain outside this implementation. The expected-head proof
is a local adapter test, not a network product. No existing consumer requires changing
these semantics. Seal Action command-sequence checks use the installed candidate;
registry-backed integration remains part of published-consumption acceptance.

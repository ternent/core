# Concord alpha implementation blueprint

Shipping design update, 2026-11-20: independent memberships are accepted in
[ADR 0015](../adr/0015-keep-audience-memberships-independent.md).
The [group design draft](group-profile-design.md) proposes scoped authoring,
readable/locked replay and explicit projection coverage. The interfaces below still
describe the single-audience baseline; revise them together during B03/B04 rather
than treating its all-key requirement as the final shipping behavior.

Status: first-slice contract, 2026-10-21. Identity, Armour and the private immediate
commit/register slice are implemented; [migration evidence](../engineering/alpha-first-slice.md)
records executed checks and remaining increments. The local handshake is the first
end-to-end application, followed by draft and reusable storage work. The
[accepted architecture](alpha-architecture.md) and ADRs 0001–0005 remain in force.
New decisions are recorded in ADRs 0006–0009. No legacy compatibility is implied.

Start with this path:

```text
create -> dispatch/commit -> export -> open -> verify -> replay -> inspect
```

`open` already verifies and replays; the explicit verify/replay calls demonstrate
independent verification and repeatability rather than required extra loading steps.
The normative details are split by ownership:

| Contract                                                       | Source                                                                 |
| -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| Signed wire schema, canonical bytes, IDs, signatures, ancestry | [Protocol 1](alpha-protocol.md)                                        |
| Bootstrap, authorization, group keys, two-stage system replay  | [Standard profile 1](standard-profile.md)                              |
| Fixed artifacts and observable success/failure checks          | [Conformance](conformance.md) and [vectors](vectors/README.md)         |
| Runtime, typed models, module ownership, delivery              | This blueprint                                                         |
| Published artifact and feedback gates                          | [Package tooling contract](../engineering/package-tooling-contract.md) |

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
type ReadyState<S> = {
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
  replay(): Promise<Result<Readonly<S>>>;
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
were delivered in Step 4. The draft-specific guards apply when draft authoring is added.

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
  application: "valid" | "invalid" | "unsupported" | "locked" | "not-run";
  freshness: "unanchored" | "equal" | "ahead" | "behind" | "diverged" | "unrelated";
  otherRecipientsDecryptability: "unverified";
  requirements: readonly { kind: "system" | "model"; ref: ModelRef }[];
  lockedEntries: number | null; // null if structure/profile could not be interpreted
  findings: readonly ConcordError[];
  history: readonly CommitRecord[]; // raw public envelopes; [] when unparseable
};
```

Verification counts only records successfully checked in each phase; an unsupported
suite leaves signature-checked commits at zero. A valid report counts all records.
Unknown requirements appear in `requirements` only when unavailable/mismatched, in
system-then-model order. Inspection merges findings in protocol, requirements,
freshness, system, model order. Protocol failure prevents later phases. Resolve
requirements before system execution; freshness failure also stops replay. No reader
or read at head sets application locked; count all application entries as locked in
that case. Missing epoch keys count entries using those epochs. A cryptographic
failure with an available epoch key is invalid, not merely locked. The inspection
report marks other recipients' decryptability `unverified` because the host can only
check wraps addressed to its own reader.

`handle.verify()` verifies committed bytes without replaying or upgrading readiness.
`handle.replay()` performs both complete stages against the fixed committed snapshot
and returns its fresh projection; it cannot bypass verification or replay a range.
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
      decide(
        input: C[K],
        state: Readonly<S>,
        ctx: DecisionContext,
      ): Result<readonly E[], ModelIssue>;
    };
  };
  validateEvent(input: unknown): Result<E, ModelIssue>;
  requirements(event: E): readonly Capability[];
  reduce(state: Readonly<S>, event: E, facts: SystemFacts): Result<S, ModelIssue>;
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

The first-slice storage proof uses a copied byte buffer, not a runtime storage option.
When board publication is added, its minimum separate adapter interface is
`read(): Promise<Result<Uint8Array | null, StorageError>>` and
`write(bytes: Uint8Array): Promise<Result<void, StorageError>>`. A richer adapter
advertises `expectedHead: true` and supplies
`writeExpected(bytes, expected: CommitId | null)`, atomically comparing remote head
before replacement; null means create only if absent. The adapter returns
`HEAD_CONFLICT` with remote bytes/revision reference. It cannot claim concurrency
protection by doing a non-atomic read then write. Runtime commit is never rolled back
by failed publication; retain both local and returned remote snapshots.

## 6. Toolchain and implementation order

The [repository architecture](../engineering/repository-architecture.md) and
[release/deployment contract](../engineering/release-and-deployment.md) now specify
Step 0 in detail: replacement workspace, Vite+ profiles, independent package releases,
and Cloudflare apps. Their concrete tool choices supersede the earlier evaluation
language in this section; the runtime/protocol delivery sequence remains unchanged.

Design baseline: ESM only for new alpha outputs, ES2022 syntax, Node 22 and 24 test
lanes, plus a browser fixture with TextEncoder, typed arrays, and secure randomness.
No CommonJS/UMD alpha promise. Browser CI must use pinned runner/browser versions and
exercise real encryption; do not infer support from a syntax target. Record exact
package-manager/tool pins in the pilot. The old Node 23 development pin is not a
published runtime promise. Seal/Action and UI compatibility are separate migrations.

| Step | Deliverable                                                                                        | Exit gate                                                                                                                                       |
| ---- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 0    | Capture clean-rebuild baseline; choose/pin pilot tools; introduce portable tooling library profile | Source checks, build, declarations, isolated tarball imports catch absent entrypoints and undeclared dependencies; report elapsed scope/runtime |
| 1    | Identity strict primitives and Armour binary pure TS age                                           | Fixed derivation/signature vectors; TS -> age and age -> TS decrypt; independently packed Identity/Armour consumers; no Rage WASM               |
| 2    | Protocol parser, canonical encoder, IDs, verifier, compare                                         | Primitive and signed owner vectors plus every P/C case in conformance; protocol-only import works without model/keys/age engine                 |
| 3    | Standard bootstrap, register model, create/dispatch/export/open/inspect                            | All first-slice R cases, no trusted state on tamper/locked/incompatible; identical saved-history replay                                         |
| 4    | Standard member events                                                                             | Atomic failed commits, grant vs administer, historical key admission and revocation branches                                                    |
| 5    | Private artifact handoff via local MCP                                                             | Two signed terms, offline invited verification, tamper and divergence inspection, digest-gated release                                          |
| 6    | Whole-document store and expected-head memory/file proof                                           | Reopen, no staged-state leakage, simulated race retains local candidate, divergence classified and surfaced                                     |
| 7    | Alpha release candidate                                                                            | Exact candidate tarballs, Node/browser fixtures, package/type/behavior/lint/format gates and handshake walkthrough                              |

Draft authoring remains its own runtime increment. The board contract below is retained
for the later application example and depends on draft authoring and the storage proof.

Steps are vertical increments, not parallel rewrites of all packages. First-slice done
means Steps 0–3 and the corresponding acceptance rows. The Step 1 privacy prerequisite
is intentional; shipping a temporary plaintext profile would give false completion.
Do not refactor old Workspace or Ledger merely to get legacy suites green. Use explicit
workspace dependencies for candidate packages; never test a changed local package via
its registry predecessor. Keep unrelated packages outside the candidate release set.

Keep Oxfmt, Oxlint, type checking, tests, build, and check:package separate as prescribed
by the tooling contract. At design time root provides Oxfmt 0.50.0 scripts using its
defaults; no formatter config was found. Oxlint adoption and package scripts are
Step 0 work. Do not publish a green `check`
that silently skips a missing gate. Choose build implementation after a consumer pilot;
Vite+'s tsdown-backed library profile is selected by the repository design, while the
build implementation remains separate from the protocol contract.

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

There is no blocking product question for the first slice. One shared private audience,
full history on admission, strict all-or-nothing projections, and local volatile drafts
are explicit alpha constraints rather than prompts for an implementer to guess. A
product needing private task subsets or future-only membership needs a separately
specified profile/model; it must not quietly widen this alpha.

Networking, profiles/directories, consensus, merges, recovery, continuity, key rotation
of identities, checkpoints, partial authoritative replay, model upgrades, and
multi-document queries remain outside this implementation. The expected-head proof
is a local adapter test, not a network product. No existing consumer requires changing
these semantics; standalone Seal Action compatibility must be investigated before
its own migration, not guessed here.

Evidence rechecked on 2026-10-21 at `8f78367`: Concord/Ledger remain excluded from the
workspace; Concord types still depend on public Ledger/Seal abstractions; legacy
Identity signBytes prepends context; Identity tests mostly compare derivation paths
without fixed public conversion/age outputs; Armour still declares Rage; Concord's
tests cover atomic replay failure and tampering but use old plugins/source imports.
Root Oxfmt reports 0.50.0; age reference CLI reports 1.3.1. These motivate fixture,
ownership, and consumer gates. No legacy build or behavior suite was rerun for this
documentation task. Existing runtime-test edits are outside this delivery.

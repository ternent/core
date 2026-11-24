# @ternent/concord

[Agent interface guide](llms.txt): public imports, examples and lifecycle contracts.

A framework composing Ledger, Identity and Armour into portable signed documents
with independent encrypted groups and explicit application replay coverage.
The runtime implements
create → dispatch/commit → export → open → verify → replay → inspect.

Concord stores its framework records inside the common `ledger` v1 container.
Ledger owns entry staging, commit construction, signatures, verification and ordered
history. The signed genesis commit's `metadata.concord` declares the system and model.
A raw Ledger entry keeps its `system` or `application` kind, with the framework
envelope in `subject.payload.data`. Encrypted application values remain ciphertext;
Ledger's JSON envelope does not make them plaintext.

Concord retains command-intent drafts and model previews. When committing, it creates
a private Ledger candidate, prepares/encrypts and appends the entries, commits through
Ledger, and validates full system and application replay before adopting the candidate.
Failures retain the active signed history and command draft. Storage publication is
still separate. A standalone Ledger reader can verify/export the same container
without a Concord model, decryptor or permission system.

This alpha breaks the former Concord-only signed container; no legacy import or
conversion adapter is included. See [the current profile](../../docs/concord/alpha-protocol.md)
and [ADR 0018](../../docs/adr/0018-use-one-ledger-container-for-concord.md).

```ts
import { createDocument, openDocument } from "@ternent/concord";
import { createStandardSystemProfile } from "@ternent/concord/system";
import { registerModel } from "@ternent/concord/testing";
import { generateIdentity } from "@ternent/armour";
const generated = await generateIdentity();
if (!generated.ok) throw new Error(generated.error.code);
const system = createStandardSystemProfile();
const created = await createDocument({ model: registerModel, system, identity: generated.value });
if (!created.ok) throw new Error(created.error.code);
const committed = await created.value.dispatch("set", { value: "hello Concord" });
if (!committed.ok) throw new Error(committed.error.code);
const reopened = await openDocument({
  bytes: created.value.export(),
  model: registerModel,
  system,
  signer: generated.value,
});
const report = await reopened.verify();
const replayed = await reopened.replay();
```

Root exports the lifecycle, model definition helper, and their public types.
`/protocol` verifies bytes without a model, runtime, decryption or age import.
`/system` supplies the standard private profile, `setMember`, `removeMember`, and
`createGroup` and specialist types. `document` is the default group. A default-group
writer may create an independently administered group; the document owner gets no
automatic access. Pass `{ audience, identity, capabilities }` to `setMember` and
`{ audience, identityId }` to `removeMember`; omitting audience selects `document`.
Admission/re-admission grants that group's full history. Removal rotates only that
group's future key; retained historical access remains readable.
`/testing` supplies the exact register model, literal model-conformance checks, and
copied-buffer artifact storage. `createMemoryExpectedHeadStore()` additionally offers
`expectedHead: true` and atomic `writeExpected(bytes, expectedHead)` for writers sharing
that reference instance. Null means create-only; a conflict returns `HEAD_CONFLICT`
with copied `error.remote` bytes. No test runner is a production dependency.

Storage publication is explicitly separate from dispatch/commit. Failed I/O or head
conflict preserves local history and drafts. Retain both local and remote snapshots;
compare them with `/protocol` and select explicitly. Expected-head comparison does
not provide ancestry policy, model validity or read freshness; use a remembered anchor
when opening. These are in-memory reference helpers, with no cross-process/provider
atomicity claim. See [the storage contract](../../docs/concord/storage-boundary.md).

Immediate commits are the default. Pass `mode: "draft"` to create/open to stage
application commands in memory. `draft()` returns `{ baseHead, entryCount, preview }`;
subsequent commands decide against that preview. `state()`, `inspect()`, `export()`,
`verify()` and `replay()` continue to describe committed history.

Call `commit({ message: "Group edits" })` to encrypt the staged events and create one
signed commit, or `discardDraft()` to drop the preview. Genesis always commits
immediately. Drafts are volatile and never included in exports. Failed dispatch or
commit retains the previous committed state and any successful staged work for retry.
Pending command intents stay in memory. Consumers choose immediate or draft authoring
and own any autosave or recovery of unfinished work. Export and external storage
contain committed history only; Concord has no draft persistence adapter or recovery
format. See [the persistence decision](../../docs/adr/0019-keep-draft-persistence-with-consumers.md).
A draft can batch several commands targeting different groups; each command still
selects exactly one audience. Commit metadata is public and signed.

All mutation is serialized per handle, with complete candidate verification/replay
before atomic publication. Read-only and inspection handles reject writes. Empty or
immediate-mode `commit()` returns `NO_DRAFT`. Group/membership operations require an
immediate-mode handle: on a draft handle they return `DRAFT_PENDING` when work is
staged, otherwise `HOST_CONFIGURATION`. There is no implicit mode switch.
The standard profile rejects unknown system events with `UNSUPPORTED_SYSTEM_EVENT`.
Inspection marks other recipients' decryptability as `unverified`.

A command's optional `audience(input)` selects one group (default `document`) before
its decision receives scoped facts. The model's `audience(event)` must return the
same group for every emitted event and match signed envelopes during replay.
A command cannot span audiences.

Models requiring all events remain locked when any event is unavailable. Opt into
readable views with `reduceLocked(state, { audience, epoch }, facts)`. Ready states
and `replay()` results both carry `coverage: "complete" | "readable"` and
`lockedEntries`; `replay()` returns `{ projection, coverage, lockedEntries }`.
Inspection exposes ordered readable/locked `entries` and public `audiences` after
the complete system pass, including when subsequent model replay fails. Scoped
coverage does not validate hidden application semantics.

Protocol and semantic failures are separate. Invalid, locked, incompatible and stale
imports remain exportable inspection evidence. Projection is derived; storage is not
trust. Ready exports are canonical; inspection exports retain original bytes.

The [protocol](../../docs/concord/alpha-protocol.md),
[standard profile](../../docs/concord/standard-profile.md) and
[conformance contract](../../docs/concord/conformance.md) define the current wire,
authority, encryption and acceptance behavior. Git retains previous implementations.

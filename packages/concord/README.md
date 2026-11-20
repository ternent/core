# @ternent/concord

Portable signed documents with verified private replay. The first alpha slice implements
create → dispatch/commit → export → open → verify → replay → inspect.

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
specialist types. Admission grants access to the document history. Removal rotates the
audience key for later entries.
`/testing` supplies the exact register model, literal model-conformance checks, and
copied-buffer artifact storage. No test runner is a production dependency.

All mutation uses immediate commits, serialized per handle, with candidate verification
and complete replay before publication. Read-only and inspection handles reject writes.
Requesting draft mode returns `HOST_CONFIGURATION`. The standard profile rejects
unknown system events with `UNSUPPORTED_SYSTEM_EVENT`. Inspection marks other
recipients' decryptability as `unverified`.

Protocol and semantic failures are separate. Invalid, locked, incompatible and stale
imports remain exportable inspection evidence. Projection is derived; storage is not
trust. Ready exports are canonical; inspection exports retain original bytes.

[The normative architecture](../../docs/concord/implementation-blueprint.md) defines
schemas, errors and acceptance checks. [Migration evidence](../../docs/engineering/alpha-first-slice.md)
records what was reused, replaced, checked and deferred. The previous Ledger/plugin
implementation is retained in `legacy/`, excluded from the active module and npm files.

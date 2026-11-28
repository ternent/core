# @ternent/concord

[Agent interface guide](llms.txt): public imports, examples and contracts.

Shared, signed, partly private documents built from your application's events. You
define a model; Concord gives you a document that several people can write to, with
private groups inside it, that anyone holding the file can verify.

```ts
import { createIdentity } from "@ternent/identity";
import { createDocument, defineModel, openDocument } from "@ternent/concord";

const notes = defineModel({
  id: "notes",
  version: 1,
  initial: () => ({ notes: {} }),
  reduce(state, event, { author, version }) {
    if (event.type === "note.put")
      return { notes: { ...state.notes, [event.data.id]: event.data.title } };
    throw new Error(`Unknown event ${event.type}`);
  },
});

const [alice, bob] = [await createIdentity(), await createIdentity()];
const doc = await createDocument({ model: notes, identity: alice });
doc.stage({ type: "note.put", data: { id: "1", title: "Hello" } });
await doc.commit();

const team = await doc.createGroup();
await doc.setMember(bob.publicIdentity, { group: team, role: "member" });
const bobs = await openDocument(doc.export(), { model: notes, identity: bob });
bobs.state(team);
```

## Model

A model is an `id`, a `version`, `initial()` and `reduce(state, event, { author, version })`.
`reduce` is synchronous and pure. It receives frozen state and returns the next state;
throwing rejects the event. An event is `{ type, data }` with JSON `data`.

An optional `squash(events)` may shorten a draft before it is signed. Concord replays both
versions and fails the commit if the result differs, so squash never changes meaning.

Each group pins the model ID that created it, and each commit records the model version.
A newer model must replay older events exactly; `version` lets `reduce` branch. `state`
throws for a group with a different model or a newer version than yours.

## Document

| Member                                 | Meaning                                                                |
| -------------------------------------- | ---------------------------------------------------------------------- |
| `stage(event, { group? })`             | Adds an event to the draft after checking it with `reduce`             |
| `commit()` / `discard()`               | Signs the draft as one commit / drops it                               |
| `draft`                                | `{ group, events, state }` or `null`                                   |
| `state(group?)`                        | A readable group's state; the default group when omitted               |
| `groups`                               | Readable groups with their members and roles                           |
| `rejected`                             | Commits with no effect, with `reason` `"authority"` or `"application"` |
| `unreadable`                           | How many entries none of your keys open                                |
| `head`, `export()`                     | The head commit ID and the document bytes                              |
| `createGroup()`                        | A new group with you as its admin                                      |
| `setMember(identity, { group, role })` | Adds a member or changes a role; admins only                           |
| `removeMember(identity, { group })`    | Removes a member and rotates the group key; admins only                |
| `rebase(remote, { published })`        | Reapplies your unpublished commits onto another copy                   |

A draft belongs to one group. Group operations commit immediately and throw while a draft
has events. Call `stage` then `commit` to write immediately. Errors are ordinary `Error`s.

## Groups

Genesis creates the default group with its creator as admin. Anyone who can add to the
file can create a group and becomes its only admin. Roles are `member` (read and write) and
`admin` (also manages members); a group always keeps one admin.

Each group's state is built only from its own events, so every member of a group computes
the same state whatever other groups they are in. A new member receives every past key and
reads the whole history. Removing a member gives the group a new key for future events;
they keep what they already had. Removal from the default group does not remove anyone from
other groups. A removed member is not told: their copy shows the group as it was when they
last could read it.

## What Concord guarantees

- Anyone holding the file can verify its history is intact and signed by the keys it names.
- A group's members can check who was allowed to make each change in that group.
- Readers with the same group history, keys and model compute the same state for it.

A signed commit that breaks a group's rules stays in the history as evidence, changes
nothing, and appears in `rejected`. A document whose history fails Ledger verification does
not open.

## What the raw file can reveal

Without keys, someone holding the file can see each commit's signer key (so an author's
activity is linkable), its claimed time, the shape of the history, how many entries each
commit has, ciphertext sizes, and how many people a key was wrapped to. Those can hint at
the kind and volume of activity. Group IDs, models, membership, roles, event types and data
are encrypted.

## Rebase

Two copies that both moved on from the same head have diverged; Concord never merges them.
`rebase(remote, { published })` takes the other copy and the last head you published. It
re-signs your own later commits on top of the remote, checking each against the remote's
current rules, and returns the commits that no longer apply. It throws rather than discard
someone else's unpublished commits, and while a draft is open.

## Limits

Readers try every key they hold on every entry, because entries carry no group label. Opening
took about 90 ms with 10 groups and 330 ms with 30 in a local measurement, growing with groups
times entries. Storage, sync, group names and UI belong to the application.

License: ISC.

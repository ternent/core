# Ternent vocabulary

The words used across the libraries, their READMEs and examples. Ternent documents are
portable, signed histories whose application state is rebuilt by replaying them.

## History

**Identity**: one Ed25519 key pair, created or restored by `@ternent/identity`. Its
`publicIdentity` is safe to share; the private seed leaves only through `export()`.

**Proof**: a Seal signature over a content hash, naming its signer and claimed time.

**History**: an immutable Ledger history of commits, verified when opened.
_Avoid_: database, log file

**Commit**: a signed step in a history, naming its parent and holding ordered entries.
The first commit is **genesis**; its ID is the **document ID**. The last is the **head**.

**Entry**: one stored item in a commit. In a Concord document every entry is one age
ciphertext.

**Diverged**: two copies that share a commit but each moved on from it. Ledger reports
copies as equal, ahead, behind, diverged or unrelated, and never merges them.

**Rebase**: reapplying your own unpublished commits on top of another copy.
_Avoid_: merge, sync

## Concord documents

**Document**: a history read through a model by one identity.

**Model**: an application's `id`, `version`, `initial()` state and `reduce` function.

**Event**: `{ type, data }`, a fact an application records. Events are staged into a
**draft** and signed together by `commit`.
_Avoid_: command, action

**State**: what a group's accepted events reduce to. It is derived, never stored.
_Avoid_: projection, snapshot

**Group**: a set of members sharing a key, with its own events and state. Every document
has a **default group** created at genesis.
_Avoid_: audience, channel, room

**Member** and **admin**: the two roles in a group. Members read and write; admins also
manage membership.
_Avoid_: capability, permission

**Epoch**: one key for a group. Removing a member starts a new epoch.

**Rejected**: a signed commit that broke its group's rules. It stays as evidence and
changes nothing.

**Unreadable**: an entry none of your keys open. You can tell it exists, nothing more.

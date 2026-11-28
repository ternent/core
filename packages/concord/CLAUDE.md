# Working on Concord

Concord is one file, `src/index.ts`: a document handle over a Ledger history, with private
groups and a model's reducer. Keep it that small.

## What Concord owns

- Groups, membership, roles, key epochs and the wraps that distribute them.
- Replay: authority first, then the model's `reduce`, per group.
- The encrypted record formats inside each entry. `test/vector.json` fixes a document and
  the state each identity sees. A change that breaks it is a format change.
- Not signatures or history (Ledger and Seal), not encryption (Armour and age), not the
  application's meaning (the model), and not storage or sync (the application).

## Rules that keep it sound

- Enforce only what the readers who rely on a rule can verify. A group's validity uses only
  that group's history; no rule may depend on another group's state.
- A key gains authority only through an accepted record: creation for epoch 0, an
  authorized removal for each later epoch. Decrypting something proves nothing.
- Opening is three passes: Ledger verification, key discovery from every wrap, then replay.
  A single pass cannot give a new member the history before they joined.
- Authoring signs through a fresh Ledger writer and adopts the result only if replaying the
  new commit accepts it, so failure leaves history and state unchanged.
- Never claim privacy the raw bytes don't give. Update the README's list if a format change
  alters what is visible.

## How the code stays small

- No command layer, capability sets, pluggable system, modes, error codes or subpaths.
  Add one only for a demonstrated need.
- Validate where data enters: `readBody` and `readWrap` for decrypted records, `captureEvent`
  for staged events. Values that passed aren't checked again.
- Let Ledger and Armour fail clearly; don't re-check what they reject.

## Checks

Run `pnpm run check` in this package under the Node version in `.node-version`. Each
replay rule has a test that fails if the rule is removed; keep it that way when adding one.
Update `README.md` and `llms.txt` with any interface change.

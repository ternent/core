# Working on Ledger

Ledger is one file, `src/index.ts`: create, open and a writer over an immutable
history. Keep it that small.

## What Ledger owns

- The v2 document format, canonical JSON, commit and entry IDs, and verification of a
  whole history on open. `test/vectors.json` fixes the bytes and IDs. A change to them
  is a new format version.
- Staging and the writer lifecycle: commit advances the writer, an empty commit
  rejects, mutations throw while a commit runs, and failure keeps history and staging.
- Not signatures: Seal builds and checks each proof. Not meaning: projections,
  permissions and storage belong to Concord or the application.

## How the code stays small

- Histories are issued only by Ledger. The private `#records` field is the brand, and
  `internals` is the only way to extend one. Never add a public method that accepts
  entries or records, or a lookalike could become trusted history.
- Validate where data enters: `prepareEntries` for appended input, `openLedger` for
  bytes. Committed entries were validated when staged and aren't checked again.
- Open accepts only canonical bytes, so there is no lenient parser. Canonical JSON is
  written by hand because JavaScript objects list integer-like keys ("2", "10")
  numerically, which breaks sorting by rebuilding an object.
- Capture input by encoding it canonically and parsing it back: the copy is detached
  and already validated. Do it before the first `await`.
- `maxBytes` is the only limit. Add another only for a demonstrated failure.
- No projections, subscriptions, replay helpers, error classes or subpath exports.

## Checks

Run `pnpm run check` in this package under the Node version in `.node-version`. Test
the observable contract: the vector, tampering, linkage, canonical-only import,
lookalike histories, the writer lifecycle and `maxBytes` at the boundary. Update
`README.md` and `llms.txt` with any interface change.

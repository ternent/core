# @ternent/ledger

[Agent interface guide](llms.txt): public imports, examples and contracts.

A signed, append-only history of JSON entries. Each commit is signed with a Seal proof
by an Identity. Ledger verifies history; your application decides what it means.

```ts
import { createIdentity } from "@ternent/identity";
import { createLedger, createWriter, openLedger } from "@ternent/ledger";

const alice = await createIdentity();
const genesis = await createLedger({ signer: alice, metadata: { model: "expenses" } });

const writer = createWriter(genesis, alice);
writer.append({ kind: "expense.recorded", payload: { amount: 2500 } });
const history = await writer.commit();

const bytes = history.export();
const reopened = await openLedger(bytes); // verifies every commit
for (const commit of reopened.commits) {
  for (const entry of commit.entries) apply(entry, commit.proof.signer);
}
```

## History

A `History` is immutable and only comes from `createLedger`, `openLedger` or a
writer's `commit`. It has `documentId` (the genesis commit ID), `head`, and `commits`
in order, starting with genesis. Each commit has its `id`, `parent`, `entries`, optional
`metadata`, and its Seal `proof`, which carries the signer and claimed `createdAt`.

`history.compare(other)` returns `"equal"`, `"ahead"`, `"behind"`, `"diverged"` or
`"unrelated"`. Ledger never merges diverged histories. `history.export()` returns the
canonical document bytes.

## Writer

`createWriter(history, signer)` stages entries on top of a history.

- `append(entry | entries)` validates and copies the whole batch before staging any of it.
- `commit(metadata?)` signs the staged entries, advances `writer.history` and returns
  the new history. Earlier histories are unchanged. Committing with nothing staged rejects.
- While a commit runs, `append`, `discard` and `commit` throw; `history` and `staged`
  still read the previous state. A failed commit keeps both, so you can retry.

An entry is `{ kind, payload, meta?, nonce? }`. `kind` is 1–128 characters, `payload`
is any JSON value, `meta` a JSON object. A nonce is generated unless you supply 16 bytes
of base64url. JSON here means null, booleans, strings, safe integers, arrays and plain
objects.

## Trust and limits

A valid history proves who signed each commit and that nothing was changed or
reordered. It doesn't say whether a signer was allowed to write: that is the
application's rule. It can't detect a rolled-back or withheld copy either; compare
with a head you remember.

`openLedger` accepts only the exact canonical bytes that `export()` writes. The one
limit is `maxBytes` (default 16 MiB), set on `createLedger` or `openLedger` and
inherited by writers.

## Format

The document is `{"commits":[…],"format":"ledger","version":2}`, as canonical JSON
(keys sorted by UTF-16 code units, no whitespace). Each commit is `{ body, proof }`,
where `body` is `{ parent, nonce, entries, metadata? }`.

```text
proof    = Seal proof over UTF8("ledger.commit/2") || 0x00 || body
commitId = "commit:" + sha256hex(UTF8("ledger.commit-id/2") || 0x00 || proof)
entryId  = "entry:"  + sha256hex(UTF8("ledger.entry-id/2")  || 0x00 || { author, entry, parent })
```

Genesis has a null parent and may be empty; every later commit names the previous
commit and has at least one entry. Entry nonces are unique within a commit.

License: ISC.

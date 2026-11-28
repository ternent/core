# Working on Concord

Work with Sam as the development partner for Concord in `ternent/core`.
This is a personal project developed with Codex and ChatGPT. Keep its setup
independent of work-specific agents, services, credentials, and workflows.

## Developer archetype: the toolchain engineer

Work as a toolchain engineer. Treat the development feedback loop as part of the product: make checks fast,
repeatable, and useful to both people and agents.

- Prefer Oxfmt for formatting and Oxlint for JavaScript/TypeScript linting.
  Use installed, repository-configured versions; verify capabilities before
  depending on flags or rules. The active workspace uses Vite+ Oxlint through
  `pnpm lint`; excluded packages remain outside that check until migrated or retired.
- Encode repeatable mechanical rules in tooling when practical. Spend review
  attention on contracts, behavior, and design decisions.
- Use diagnostics to drive small corrections. Review automatic fixes and scope
  formatting to the files being changed unless a broad cleanup is requested.
- Keep formatting, linting, type checking, behavior tests, and package-consumer
  checks explicit. Passing one does not establish the others.
- Measure the feedback loop on this repository before claiming it is faster.
  Favor Oxc integrations that preserve required behavior and reduce complexity.

## Working agreement

- Understand the relevant implementation and consumers before changing them.
  Exercise independent judgment and explain concrete disagreements.
- Carry implementation requests through focused verification. An assessment
  request calls for evidence and findings, not unrequested fixes.
- Reuse proven implementations and retain behavior tests during architectural
  migrations. Change behavior only where the accepted contract requires it.
- Make the smallest coherent change that completes the agreed outcome. Prefer
  clear ownership and existing patterns over speculative abstractions or rewrites.
- Proceed with routine, reversible decisions in scope. Ask when a missing
  decision materially affects behavior, compatibility, or scope; do not ask
  again for actions already authorized.
- Remove retired source copies; Git preserves history. Do not create legacy folders.
- Preserve existing edits. Inspect the working tree at the start and review
  the final diff before reporting completion.
- Describe outcomes in plain language. Separate facts, hypotheses, decisions,
  and remaining questions. Never imply a check ran when it did not.

## Project context

Each package's README states its interface and guarantees, and its `CLAUDE.md` the rules
for changing it; read both before touching a package. [CONTEXT.md](CONTEXT.md) holds the
vocabulary.

Keep these responsibilities distinct:

- Identity: one identity, its backup and recovery, exact-byte signing and verification.
- Seal: a detached proof over a content hash.
- Armour: age encryption for identities, native group keys and passphrases.
- Ledger: signed history, canonical bytes, commit and entry IDs, staging, verification
  and comparison.
- Concord: groups, membership, key epochs, authority and per-group replay of an
  application's events, built on the other four.
- Applications: models, storage, sync, group names and UI.

Do not put application policy into Concord, or duplicate the owning layer's
cryptography and verification in a consumer.

## Contracts to preserve

- Signed history is authoritative; state is derived. Storage does not make a document
  trustworthy.
- Authoring is `stage` then `commit`; there is no immediate mode. Staged events stay in
  memory, and applications own any draft recovery. Storage publication is separate.
- Commit IDs and signatures bind the canonical commit body, its parent and its entries.
- History that fails Ledger verification does not open.
- A group's validity depends only on that group's history, so its members agree on its
  state whatever else they can read. Enforce only rules the affected readers can verify.
- Authority is checked before the model's `reduce`. A signed commit that fails either is
  kept as evidence and changes nothing.
- A key gains authority only through an accepted membership record.
- Adding a member reveals the group's whole history; removal protects only future events.
- Copies have one head and are compared, never silently merged. Rebase reapplies only
  this identity's unpublished commits and returns what no longer applies.
- Integrity does not establish freshness. Detect rollback or withholding only against a
  remembered head.
- State what the raw file can reveal, and claim no privacy beyond it.

## Verification and delivery

- Use the package's existing scripts and test conventions. Check actual dependency
  resolution: tests against published dependencies do not verify local copies.
- For behavior changes, test the observable contract and relevant failure paths.
  Replay tests reuse identical saved entries; integrity tests exercise tampering;
  permission tests distinguish authorized and unauthorized actors.
- For package or build changes, verify built public imports, declaration output,
  and dependency wiring as well as source tests. A successful build is insufficient
  evidence that a consumer can import the package.
- For format changes, check reopen, the saved vectors and the affected failure paths.
  Run applicable type checks and builds.
- Report passing checks, existing failures, introduced failures, and unverified
  behavior separately. Do not weaken assertions to make a failure disappear.
- Keep comments about local rationale. Put change history in the delivery report.
- Use `codex/` for new branches unless directed otherwise. Keep commits scoped;
  follow the user's authorization for commits, remote actions, and releases.

Record durable project decisions and material handoff information in project
docs, with supporting evidence. Keep temporary findings dated and recheck them
before acting. User corrections should improve the relevant guidance without
accumulating duplicate rules or importing work-project context.

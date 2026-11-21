---
status: accepted
---

# Use one Ledger container for Concord

Working decision, 2026-11-21. The accepted answer is:

> yes

To this question:

> Should Concord adopt the common Ledger container, accepting a breaking change to current Concord alpha documents?

The five public packages are Identity, Armour, Concord, Seal and Ledger. This
replaces the Tooling product in the earlier release boundary; tooling is repository
infrastructure. It supersedes the Ledger ownership in
[ADR 0001](0001-center-the-alpha-on-concord.md) and the product list in
[ADR 0017](0017-drop-ui-from-the-library-release.md) where they conflict.

Ledger is independently usable and owns the common signed container, entry staging,
commit construction, hashes, signatures, chain verification, import/export and
ordered replay. Concord consumes that lifecycle and composes commands, authority,
group membership, encryption orchestration and application replay. Its framework
records live within the Ledger container. A separate Concord signed container and
commit engine are not the target.

This gives signed history one owner and keeps the standalone log useful without
adopting the framework. The original composition in
`samternent/home/packages/concord/src/app.ts` provides delegation evidence; the
scoped source Ledger is `samternent/home/packages/ledger-v2`.

The common format breaks compatibility with the current Concord alpha documents.
Their existing bytes and vectors are not assumed readable under the new format.
Legacy import or conversion support is separate scope. Original standalone Ledger
encryption conveniences and staged-state persistence still require explicit
retain, move or drop decisions; accepting the common container does not settle them.

This records an accepted target, not completed integration or release evidence.

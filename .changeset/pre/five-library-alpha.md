---
"@ternent/identity": minor
"@ternent/armour": minor
"@ternent/ledger": minor
"@ternent/concord": minor
"@ternent/seal": minor
---

Establish the five-library alpha: standalone Identity, Armour, Ledger and Seal,
with Concord composing Ledger's common signed container, authority, independent
encrypted groups, command drafts and application replay. The common container
deliberately replaces the previous Concord alpha wire format.

Armour uses typage and offers explicit payload codecs for Ledger. Uncommitted
entries and command intents stay in memory; consumers own draft recovery and
storage publication. Verify public imports, declarations, CLI behavior and exact
candidate bytes before publication.

# @ternent/ledger

## 0.2.0

### Minor Changes

- e5c6808: Establish the five-library alpha: standalone Identity, Armour, Ledger and Seal,
  with Concord composing Ledger's common signed container, authority, independent
  encrypted groups, command drafts and application replay. The common container
  deliberately replaces the previous Concord alpha wire format.

  Armour uses typage and offers explicit payload codecs for Ledger. Uncommitted
  entries and command intents stay in memory; consumers own draft recovery and
  storage publication. Verify public imports, declarations, CLI behavior and exact
  candidate bytes before publication.

### Patch Changes

- 7d55bda: Include agent interface guides with public imports, runnable examples, lifecycle and
  error contracts, and host-owned storage/recovery behavior.
- Updated dependencies [7d55bda]
- Updated dependencies [e5c6808]
  - @ternent/identity@0.6.0

## 0.2.0-alpha.1

### Minor Changes

- e5c6808: Establish the five-library alpha: standalone Identity, Armour, Ledger and Seal,
  with Concord composing Ledger's common signed container, authority, independent
  encrypted groups, command drafts and application replay. The common container
  deliberately replaces the previous Concord alpha wire format.

  Armour uses typage and offers explicit payload codecs for Ledger. Uncommitted
  entries and command intents stay in memory; consumers own draft recovery and
  storage publication. Verify public imports, declarations, CLI behavior and exact
  candidate bytes before publication.

### Patch Changes

- Updated dependencies [e5c6808]
  - @ternent/identity@0.6.0-alpha.1

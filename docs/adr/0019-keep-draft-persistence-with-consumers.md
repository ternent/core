---
status: accepted
---

# Keep draft persistence with consumers

Decision, 2026-11-21: Ledger stages uncommitted entries in a simple in-memory array.
Concord keeps its pending command intents in memory. These are provisional local
work, separate from signed committed history.

The consumer chooses when to commit and whether to autosave or recover unfinished
work. Ledger and Concord do not provide a persistence adapter, recovery snapshot or
restore protocol for drafts. Hosts can keep their own forms, commands or draft data
and submit them through the normal library APIs when appropriate.

Committed export, import and external storage concern signed history only. A
Git-style push/pull workflow exchanges committed snapshots. Existing explicit
divergence and pending-draft checks remain; this decision introduces no automatic
merge or rebase.

The previous Ledger's staged-state persistence is deliberately left to consumers.
It is not an outstanding library migration feature. Applications may still value
draft recovery; its behavior and storage belong to the application.

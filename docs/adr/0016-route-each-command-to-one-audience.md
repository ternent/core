---
status: accepted
---

# Route each command to one audience

On 2026-11-20, Sam chose one audience per application command:

> no, we'll stick with one. Lets keep it simple

After input validation, a command selects its audience before its decision runs.
Its decision receives the signer's facts for that audience. Every emitted event
must select the same audience, and replay checks the model's event selection
against its signed envelope. A command cannot emit entries for several groups.

Explicit draft mode may group multiple commands from different audiences into one
atomic commit, subject to the author having each command's required authority.
An application can express a cross-group operation through such a draft; it does
not require a second multi-audience command contract.

See the [group design](../concord/group-profile-design.md). The routing decision is
accepted; multi-group authoring and draft support are not yet implemented.

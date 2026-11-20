---
status: accepted
---

# Start with one private document audience and complete historical admission

The initial single-audience scope is extended by
[ADR 0015](0015-keep-audience-memberships-independent.md), accepted 2026-11-20.
Historical admission and per-audience rotation remain; the paragraph below records
the original starting decision rather than the full shipping scope.

The standard alpha profile encrypts application entries to one shared document audience
from genesis. Admitting a reader explicitly wraps every historical epoch key; removing
a member creates a fresh epoch for remaining members. This favors complete bounded
reconstruction over task-specific audiences or future-only admission, which would
require defined partial-projection semantics. Current read authority, historical write
authority, and retained key knowledge remain distinct. A host cannot certify encrypted
wraps it cannot decrypt, or revoke plaintext already obtained. See
[the standard profile](../concord/standard-profile.md).

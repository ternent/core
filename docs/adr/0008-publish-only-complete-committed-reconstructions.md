---
status: accepted
---

# Publish only complete committed reconstructions

2026-11-20 clarification: [ADR 0015](0015-keep-audience-memberships-independent.md)
retains atomic publication and full signed-history verification while introducing
explicitly scoped readable views. The [group design draft](../concord/group-profile-design.md)
proposes a complete model pass over readable events and locked markers, with
coverage carried in the result. It never labels skipped content as full application
reconstruction. That refinement is not yet implemented.

Protocol verification, historical system replay/decryption, and model reduction complete
before a candidate snapshot and projection replace the prior published state. Unknown
requirements, unavailable keys, invalid events, and incomplete ancestry produce
read-only inspection with retained original bytes. Draft previews are explicitly
provisional, volatile, and separate from committed projection/export. This rejects
best-effort skipping and legacy staged-state-as-truth behavior because either can make
different readers silently present incomplete state as the same authoritative snapshot.
See [the lifecycle interface](../concord/implementation-blueprint.md).

---
status: accepted
---

# Keep audience memberships independent

On 2026-11-20, Sam accepted treating the existing `document` audience as the
default group and keeping additional encrypted groups independent:

> sounds good, lets go with your recommendation to keep them separate

Each audience owns its members, capabilities, epoch keys, admissions and removals.
An identity can join a private group without joining the default group. Removing
default-group membership does not remove another group's membership or rotate its
keys. The default group's administrators cannot grant themselves access to an
independent group. Its writers may create groups without owner approval; the
new group's creator initially administers that group.

The genesis signer initially administers the default group. This does not give
them universal authority over every group created later. A group editor can
continue authoring in that group after losing default-group membership, provided
their group authority remains valid. Creating another group still requires
default-group write. There is no implicit document-wide ban or cascading removal.

Joining or rejoining a group grants its full history. Removing a member rotates
that group's future key; it cannot retract old keys or plaintext. System replay
establishes historical authority and available decryption before application replay.
Readable content remains inspectable even after current membership ends.

This extends the single-audience starting scope in [ADR 0007](0007-start-with-one-private-document-audience.md).
The atomic publication rule in [ADR 0008](0008-publish-only-complete-committed-reconstructions.md)
continues to hold. A readable view must explicitly distinguish locked entries and
its limited application coverage; it cannot claim full reconstruction by skipping
unavailable content.

The [group design](../concord/group-profile-design.md) proposes concrete schemas,
interfaces and acceptance checks. Those implementation details are a design draft;
this ADR records the accepted membership decision, not implemented multi-group support.

# Independent groups and readable replay

The B03/B04 slice introduced independent membership and explicit readable/locked
replay. This retained note describes that implemented behavior and where to find
its evidence. The current signed container is Ledger under
[ADR 0018](../adr/0018-use-one-ledger-container-for-concord.md); fixed documents were
regenerated for that accepted format change. Earlier Concord-only hashes and old
test counts are not current acceptance evidence.

## Behavior and authority

- A default `document` writer can create a group without owner approval. Its creator
  gets the group's four capabilities; the document owner gets no implicit access.
- Group membership is independent of `document`. Removing default membership leaves
  other group rights intact. Every command selects one audience, and every event
  emitted by that command must select that same audience.
- Admission/re-admission grants every historical epoch key for that group. Removal
  rotates only that group and wraps the new key for exactly its remaining members.
  Already obtained keys/plaintext remain available; revocation cannot erase them.
- Replay verifies complete signed history and every public authority transition
  before decryption/model callbacks. Missing keys yield locked markers; available-key
  authentication/context failure invalidates reconstruction.
- A model requires all events unless it opts into `reduceLocked`. That hook receives
  a public marker and historical audience-scoped facts. Neither failed locked handling
  nor a late readable transition may publish an intermediate trusted projection.
- Ready state and `replay()` report projection, coverage and exact locked count.
  Complete coverage has no locked entries. Readable coverage is a scoped application
  reconstruction and does not certify hidden application semantics.
- Successful system replay exposes ordered readable/locked inspection entries and
  public audience summaries, even if later model replay fails. Runtime checks profile
  output for exact coverage, signer/audience binding and closed nested member/epoch
  records before exposing that evidence.

The [group design](../concord/group-profile-design.md),
[standard profile](../concord/standard-profile.md) and
[conformance scenarios](../concord/conformance.md) own the exact current contract.
[ADR 0015](../adr/0015-keep-audience-memberships-independent.md) and
[ADR 0016](../adr/0016-route-each-command-to-one-audience.md) record the decisions.

## API and disclosure

`@ternent/concord/system` supplies `createGroup`, `setMember` and `removeMember`.
Member helpers default to `document` only when audience is omitted. Models can supply
command/event audience selectors and `reduceLocked`; omitted selectors use document
routing. Mixed command routing fails before protection/signing.

The system owns membership, group keys, wraps and epochs; Identity/Armour own the
cryptography. Each application entry is encrypted once to one named group/epoch.
No anonymous envelope, trial-decryption routing or automatic owner self-grant is
introduced. Group IDs, capabilities, signers, wrap targets, epochs/recipients,
linkage, sizes/counts and signed metadata remain public. Names and descriptions
belong in encrypted application data.

## Evidence to preserve

Saved `groups.removed.document.json` and `groups.readmitted.document.json` vectors
cover two groups, an owner outside both, independent default removal, group rotation
and full-history readmission. Literal expectations cover three readers at both heads.
Node crypto independently checked the Ledger hashes and Ed25519 signatures; expected
projections were constructed from the six intended application events, not replay.
See [vector provenance](../concord/vectors/README.md).

`packages/concord/test/groups.test.ts` covers permissions, historical access,
routing/atomicity, opted-in/full models, saved-byte determinism, signed semantic
failures, cross-group substitution, tampering before callbacks and malformed profile
streams. Membership/runtime tests retain complementary failure coverage. External
candidate consumers exercise the saved vectors and public authoring; declaration
fixtures check helpers, coverage and locked-marker narrowing. The Chromium proof
includes independent-group scoped replay.

Current gate results belong to the run reports described in the
[repository guide](repository-hygiene.md#acceptance-boundaries), not this dated note.
No publication, remote CI status or performance measurement is inferred here.

Draft authoring now groups separate single-audience commands into an atomic commit;
see [draft conformance](../concord/conformance.md#d-and-s-grouped-authoring-and-complete-standard-profile-step-4).
Draft persistence stays consumer-owned under
[ADR 0019](../adr/0019-keep-draft-persistence-with-consumers.md).
The [storage proof](../concord/storage-boundary.md) is implemented independently of
runtime publication. Remaining delivery work is on the
[release backlog](release-and-deployment.md#release-backlog).

# Concord alpha reference vectors

These files are normative inputs/outputs for Protocol 1's first slice. The private
values are **public test material**, including RFC 8032's first Ed25519 test seed;
never use them for real documents. Fixed nonces are for fixtures only.

| File                                                       | Purpose                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| [primitives.json](primitives.json)                         | Five canonicalization examples; nine raw JSON rejects; fixed identity, X25519 conversion, age encodings, raw Ed25519 signature |
| [owner.document.json](owner.document.json)                 | Complete valid private register snapshot: genesis/init plus one set event                                                      |
| [owner.expected.json](owner.expected.json)                 | Literal subject bytes, signature messages/signatures, decrypted wrap/event, projection and snapshot digest                     |
| [owner.genesis.document.json](owner.genesis.document.json) | Valid ancestor snapshot, same lineage                                                                                          |
| [owner.fork.document.json](owner.fork.document.json)       | Valid alternative child, same entries but different signed commit metadata/nonce                                               |
| [relationships.json](relationships.json)                   | Literal pairwise results for supplied snapshots                                                                                |
| [mutations.json](mutations.json)                           | Nine RFC 6902 patches to the owner artifact, each with a literal protocol integrity/error expectation                          |

Fixture fields that name `Hex` are byte strings in hex; other cryptographic wire
strings use the protocol's encodings. `canonicalSubject` is the exact JSON text before
UTF-8 encoding; `signatureMessageHex` includes the domain prefix and its zero byte.
`canonicalSnapshotSha256` hashes C(snapshot), not the pretty file on disk. Test export
by canonicalizing and comparing this digest, not by expecting preserved whitespace.
Expected files are not document containers and may contain secret fixture material.
Only `*.document.json` may be passed to the runtime as documents.
For each mutation case, clone its source, apply the RFC 6902 operations in order,
serialize as JSON, and assert the expected verifier status and first finding code.
Do not rehash or re-sign these patches: these are protocol failure vectors. System
and model failures use the deliberately re-signed construction in conformance.md.

Generated and checked on 2026-10-21 using Node 23.7.0's built-in crypto (independent
of Concord packages) and native age 1.3.1. The identity public key matches RFC 8032;
X25519 public conversion was independently calculated by the Edwards-y formula and
compared with public derivation from the converted seed. Native age generated the
two saved randomized ciphertexts, then decrypted both to exact canonical plaintext.
Node verified both commit signatures and recomputed all entry/commit IDs. Fork and
ancestor artifacts were additionally checked for hashes, signatures and relationships.

The ciphertext bytes are now fixed. Implementations decrypt/validate these artifacts;
they do not reproduce them by running randomized authoring again. A separate authoring
test encrypts new bytes, checks envelope/context invariants and independent decryption,
then reopens those saved bytes. Never demand equal IDs from freshly generated keys or
fresh authoring nonces.

The reference construction is evidence for the fixtures, not a production verifier.
Strict invalid-point/parser/authority cases in [conformance](../conformance.md) remain
implementation acceptance work. Complete profile-sharing/revocation and board fixtures
must be added in their delivery steps with literal expected outputs before claiming
those conformance levels. No alpha runtime was executed to verify these files today.

## Independent-group vectors (2026-11-20)

- `groups.removed.document.json`: two independently administered groups in one signed
  document, creator removed from default membership, Bob removed from Accounts, and
  a subsequent Accounts event encrypted under the rotated epoch.
- `groups.readmitted.document.json`: direct child admitting Bob back to Accounts as
  read-only, carrying every Accounts epoch key.
- `groups.expected.json`: fixed audience/document/head IDs, canonical snapshot digests,
  exact projections/coverage/locked counts for owner, creator and Bob, and current
  authoring rights. Expectations were constructed from the six intended events,
  independently of replay output.

These new artifacts were authored once through the runtime and saved. Built-in Node
crypto separately recomputed every entry/commit ID and verified every Ed25519 signature.
They are regression vectors, not independent native-age construction like the original
owner fixture. `groups.test.ts` opens the same bytes twice for each reader/stage and
checks the literal expected result; the isolated packed consumers do the same on
Node 22/24. Model ref is `concord.test.independent-groups`, version 1. Test identities
use the original RFC seed (owner), 32 bytes of `02` (creator), and 32 bytes of `03`
(Bob). All are public test secrets; never use them for real data.

The application events are, in order: default `shared = "default history"`; Accounts
`account = "initial account"`; Personal `personal = "private description"`; Bob's
Accounts `account = "from Bob"`; creator's Accounts `account = "after default removal"`;
and creator's Accounts `account = "after removal"`. Each event is `group.value`,
version 1, with data `{ audience, key, value, admin: false }`. The model maps values
by key, records readable actor/audience facts and records locked audience/epoch markers.
The default owner lacks both group keys; creator has all events including retained
default history; Bob sees Accounts history, one future Accounts lock while removed,
and all Accounts history after re-admission. Default/Personal remain locked to Bob.

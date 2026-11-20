# Alpha conformance and delivery gates

Shipping design update, 2026-11-20: proposed independent-group acceptance cases
G01–G19 are in the [group design matrix](group-profile-design.md#6-concrete-scenario-and-acceptance-matrix),
with a [saved semantic scenario](examples/independent-groups.json). These are planned
checks, not executed tests or cryptographic vectors. Single-audience read/locked
expectations below must be reconciled with explicit readable coverage in B03/B04.
The current library-first release does not require the deferred board application.

Status: implementation acceptance contract, 2026-10-21. Case IDs are stable test
names. A coding agent implements these as one-shot tests crossing the public interface;
private helpers may isolate crypto diagnostics but cannot replace observable checks.
The [vector artifacts](vectors/README.md) contain fixed bytes independent of the
future Concord implementation. This document also specifies cases not yet executed.

## Error contract

`ErrorCode` is the union of the codes in this table. An error has the shape defined
in the [blueprint](implementation-blueprint.md). Expected errors never throw, change
the committed head, clear a draft, or expose partial projection. Invalid opened
artifacts stay inspectable/exportable. For unexpected host exceptions, sanitize the
message; a private host diagnostic callback may receive the cause, but it is never
part of a document or public report. Alpha has no default logging callback.

| Codes                                                                                   | Phase / meaning                                                                                                                     |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `JSON_INVALID`                                                                          | input / malformed UTF-8/JSON, duplicates, invalid value domain                                                                      |
| `SCHEMA_INVALID`                                                                        | protocol / known version with missing/extra fields, invalid encoding or shape                                                       |
| `PROTOCOL_UNSUPPORTED`, `SUITE_UNSUPPORTED`, `ENTRY_KIND_UNSUPPORTED`, `RESOURCE_LIMIT` | protocol / cannot evaluate with this implementation or configured limits; integrity unsupported                                     |
| `DUPLICATE_RECORD`, `UNREFERENCED_RECORD`, `ENTRY_MISSING`, `ENTRY_ORDER`               | protocol / container membership/reference/order failure                                                                             |
| `HASH_MISMATCH`, `LINK_INVALID`, `DECLARATION_INVALID`, `HEAD_INVALID`                  | protocol / subject IDs, parent chain, genesis declarations, or selected identifiers inconsistent                                    |
| `IDENTITY_INVALID`, `SIGNATURE_INVALID`                                                 | protocol / malformed identity binding/point or failed strict signature check                                                        |
| `REQUIREMENT_UNAVAILABLE`, `HOST_CONFIGURATION`, `IDENTITY_MISMATCH`                    | requirements / no exact implementation, invalid host definition, reader/signer mismatch                                             |
| `STALE_HEAD`, `DIVERGED_HEAD`, `DOCUMENT_MISMATCH`, `ANCHOR_INVALID`                    | protocol / valid candidate fails external freshness check, or supplied anchor cannot be verified                                    |
| `SYSTEM_EVENT_INVALID`, `SYSTEM_NO_CHANGE`, `LAST_ADMINISTRATOR`                        | system / malformed transition, no-op member set, removal/demotion of last administrator                                             |
| `UNSUPPORTED_SYSTEM_EVENT`                                                              | system / unknown type/version or profile event not yet implemented; incompatible inspection                                         |
| `CAPABILITY_DENIED`                                                                     | system / historical or current actor lacks required authority                                                                       |
| `READ_ACCESS_REQUIRED`, `KEY_UNAVAILABLE`                                               | system / host cannot completely read this selected head; locked inspection                                                          |
| `KEY_WRAP_INVALID`, `DECRYPTION_INVALID`, `EVENT_CONTEXT_INVALID`                       | system / decryptable-addressed wrap invalid, ciphertext authentication failure with available key, or decrypted contextual mismatch |
| `HISTORICAL_KEY_UNAVAILABLE`                                                            | author / cannot author admission carrying every epoch key                                                                           |
| `COMMAND_UNSUPPORTED`, `COMMAND_INVALID`, `COMMAND_REJECTED`, `NO_EVENTS`               | author / command absent, validation failure, domain decision rejection, or empty emitted event list                                 |
| `EVENT_UNSUPPORTED`, `EVENT_INVALID`, `MODEL_TRANSITION_INVALID`, `MODEL_FAILED`        | model / unknown event/version, event validation failure, reducer rejection/non-JSON state, or unexpected model exception            |
| `SYSTEM_FAILED`                                                                         | system / unexpected trusted profile exception                                                                                       |
| `READ_ONLY_RUNTIME`, `INSPECTION_ONLY`, `NO_DRAFT`, `DRAFT_PENDING`                     | author / lifecycle precondition failure                                                                                             |
| `SIGNING_FAILED`, `ENCRYPTION_FAILED`                                                   | author / primitive failure creating candidate; no committed mutation                                                                |
| `STORAGE_FAILED`, `HEAD_CONFLICT`                                                       | storage / adapter failure or expected-head mismatch; local history retained                                                         |

Protocol schema validates syntax before identity semantics: wrong-length public key
or signature is SCHEMA_INVALID; well-sized but invalid point/ID is IDENTITY_INVALID;
well-sized signature with invalid R/S/equation is SIGNATURE_INVALID. Verification stops
at the first failure in the protocol's declared phase order. A missing root parent
record is LINK_INVALID, missing listed entry ENTRY_MISSING. HEAD_INVALID covers wrong
documentId/head selectors; DECLARATION_INVALID covers declaration placement. Unknown
model event is incompatible application, invalid event data or transition is invalid
application. Neither changes `integrity: valid`. System invalidity likewise does not
retroactively invalidate signatures.

`open` reason precedence is invalid protocol, incompatible protocol, unavailable
requirements, freshness, invalid/unsupported system, locked, then model failure.
Known system authority/event failure gives reason invalid; unsupported event gives
incompatible. Missing read/key gives locked. Model unknown event gives incompatible;
other model failure gives invalid. Report which layer failed. A fresh valid candidate
without an anchor reports freshness unanchored, never fresh/latest. Input parse errors
use integrity invalid, checked counts zero, no trusted history, and reason invalid.

## P: bytes, schema, and integrity (first slice)

| ID  | Input/action                                                                               | Required observation                                                                          |
| --- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| P01 | Every positive canonical case in primitives.json                                           | Exact canonical string, UTF-8 bytes and key order                                             |
| P02 | Every rejected JSON case; BOM; malformed UTF-8; trailing bytes                             | JSON_INVALID before crypto; raw bytes retained                                                |
| P03 | Unsafe JS values, NaN, Infinity, -0, sparse array, accessor, custom prototype, cycle       | Author input rejected without invoking accessors or signing                                   |
| P04 | Padded/non-URL base64, nonzero unused bits, uppercase hash, wrong byte length, extra field | SCHEMA_INVALID; no normalization                                                              |
| P05 | Fixed Identity seed and supplied conversion outputs                                        | Exact public identity ID, private/public X25519, age strings, RFC8032 empty-message signature |
| P06 | Identity ID changed with correctly rebound commit hashes/signatures                        | IDENTITY_INVALID; ID cannot select another key                                                |
| P07 | Small/mixed-order public point, non-canonical point; signature R small-order or S >= L     | Strict rejection, independent of crypto library permissive defaults                           |
| P08 | owner.document.json and expected bytes                                                     | Two entry IDs, two commit IDs, exact signature messages/signatures, valid protocol report     |
| P09 | Change child signed metadata without changing its ID                                       | HASH_MISMATCH; no reducers invoked                                                            |
| P10 | Change child signature only, retaining length/canonical encoding                           | SIGNATURE_INVALID                                                                             |
| P11 | Remove referenced entry; repeat entry/commit; append detached record                       | ENTRY_MISSING; DUPLICATE_RECORD; UNREFERENCED_RECORD respectively                             |
| P12 | Swap physical entries but preserve commits                                                 | ENTRY_ORDER                                                                                   |
| P13 | Reorder ordered entry IDs in a multi-event commit without rehashing                        | HASH_MISMATCH; after rehashing but not signing, SIGNATURE_INVALID                             |
| P14 | Rehash/re-sign child with wrong parent, or entry parent not equal child parent             | LINK_INVALID; valid signatures cannot repair linkage                                          |
| P15 | Duplicate genesis, missing genesis, non-null child declaration, wrong head/doc ID          | No trusted state; appropriate duplicate/link/declaration/head code                            |
| P16 | Unknown suite/protocol; exceeded resource/depth limit                                      | Unsupported inspection, not a claim of invalid cryptography                                   |
| P17 | Whitespace/key-order changes or unsigned container metadata change                         | Same history IDs/signatures; canonical export stable                                          |
| P18 | Signed genesis profile/model ref unknown to host                                           | Protocol valid; REQUIREMENT_UNAVAILABLE on open; no automatic module load                     |
| P19 | Large bounded arrays and attacker keys such as **proto**                                   | Bounded parser behavior, no prototype mutation, no unchecked recursion                        |

P13's two-event input is constructed by repeating the register command twice in draft
mode in Step 4; before then use the protocol helper with two saved valid entry subjects
bound to the same parent. No reissuing commands to establish replay determinism.

## C: lineage and anchors (first slice)

| ID  | Inputs                                                  | Required observation                                     |
| --- | ------------------------------------------------------- | -------------------------------------------------------- |
| C01 | Same snapshot, including transport formatting variants  | equal                                                    |
| C02 | Genesis compared to child and child compared to genesis | behind; ahead                                            |
| C03 | owner compared to owner.fork                            | diverged in both directions, both integrity-valid        |
| C04 | Two independently created genesis documents             | unrelated                                                |
| C05 | Any comparison containing invalid/unsupported bytes     | Error, never equal/diverged                              |
| C06 | Open child anchored to genesis / same child             | Ready; freshness ahead / equal                           |
| C07 | Open genesis anchored to child                          | Freshness inspection, STALE_HEAD, integrity valid        |
| C08 | Open fork anchored to child / unrelated anchor          | DIVERGED_HEAD / DOCUMENT_MISMATCH; no model replay       |
| C09 | Open older valid snapshot with no anchor                | Integrity valid; unanchored; no false rollback detection |
| C10 | Malformed/invalid anchor                                | ANCHOR_INVALID; candidate cannot become ready            |

## R: create, commit, export, open, verify, replay, inspect (first slice)

| ID  | Action                                                                                 | Required observation                                                                            |
| --- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| R01 | Create register with owner and standard profile                                        | One signed genesis/init; owner all four rights; initial { value: "" }; ready                    |
| R02 | Immediate set({value:"hello Concord"})                                                 | Exactly one child commit and event; ready value; storage not invoked                            |
| R03 | Export then open with model/profile/owner                                              | Same doc ID/head, committed value, no private material or projection in wire                    |
| R04 | Verify export without model/profile/reader                                             | Integrity valid independently; no extension execution                                           |
| R05 | Replay identical saved export twice, then new open                                     | Equal projections and reports; no fresh key/time/ID generation during replay                    |
| R06 | Open owner.document using public test seed                                             | Matches literal expected projection, IDs, event plaintext and key material derivation           |
| R07 | Open without reader or with unrelated reader                                           | Locked inspection, READ_ACCESS_REQUIRED, no projection/writes; byte-exact inspection export     |
| R08 | Open with authorized decrypt-only reader                                               | Ready same projection, canWrite false; all mutations READ_ONLY_RUNTIME                          |
| R09 | Tampered reachable record                                                              | Invalid inspection, no model calls, raw evidence/report available                               |
| R10 | Omit or mismatch required model/profile                                                | Incompatible inspection, exact missing refs; integrity remains independently verifiable         |
| R11 | Correctly sign event encrypted to wrong epoch key or corrupt age bytes and rehash/sign | Integrity valid, DECRYPTION_INVALID with available expected key; no projection                  |
| R12 | Correctly sign decryptable plaintext with wrong parent/nonce/model/epoch               | EVENT_CONTEXT_INVALID, not a reducer error                                                      |
| R13 | Valid signed unknown event, invalid data, reducer rejection/throw                      | EVENT_UNSUPPORTED / EVENT_INVALID / MODEL_TRANSITION_INVALID / MODEL_FAILED; no partial publish |
| R14 | Unknown command, invalid input, decision rejection, empty event list                   | Specific author error, same export/projection; no new commit                                    |
| R15 | Inject sign/encrypt failure or candidate replay failure                                | Specific error; previous export, projection, draft unchanged                                    |
| R16 | Parallel dispatch calls; reads while encryption awaits                                 | Invocation order, parents chained correctly; reads see last published state                     |
| R17 | Mutate caller input bytes, returned bytes, projection or reports                       | Internal snapshot/history/projection unaffected                                                 |
| R18 | Replay on ready handle, verify on inspection, export malformed input                   | No bypass or upgrade of trust; original bytes remain available                                  |
| R19 | Genesis init owner mismatch; missing/wrong owner wrap; duplicate init                  | Integrity can be valid; SYSTEM_EVENT_INVALID or KEY_WRAP_INVALID; no ready state                |
| R20 | No-command genesis opened without reader                                               | Locked, lockedEntries 0, no projection; owner is still private-profile member                   |

For R11–R13/R19, an offline fixture builder must explicitly rehash affected entries,
rebuild ordered commit subjects, re-sign using public test seeds, and rebind head/doc
IDs as needed. Changing ciphertext alone without this process tests protocol integrity,
not system/model validation. Keep encryption plaintext contexts consistent except the
specific field under test. Reference outputs remain literal fixture files, not values
computed by the production verifier under test.

## D and S: grouped authoring and complete standard profile (Step 4)

| ID  | Action                                                                         | Required observation                                                                                               |
| --- | ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| D01 | Two successful draft sets                                                      | Original head/projection unchanged, preview latest value, two staged intents                                       |
| D02 | Commit with {message:"Group edits"}                                            | One new commit, ordered entries, signed metadata, cleared draft                                                    |
| D03 | Fail second draft command / fail commit signing or replay                      | First draft retained / entire draft retained; no committed change                                                  |
| D04 | Export/reopen while drafting                                                   | Only committed history reopens; no staged keys or data in artifact                                                 |
| D05 | Discard, empty commit, system action while drafting                            | Preview discarded; NO_DRAFT; DRAFT_PENDING                                                                         |
| S01 | Owner adds viewer, editor; grants full history                                 | Both reconstruct exact prior projection with their own capability                                                  |
| S02 | Viewer application write / editor grant / grant-only actor granting administer | CAPABILITY_DENIED in authoring and equally in forged signed history                                                |
| S03 | Owner grants bounded grant privilege; delegate adds editor                     | Delegation follows exact subset/target rules; no privilege amplification                                           |
| S04 | Set same rights, remove absent member, demote/remove last administrator        | SYSTEM_NO_CHANGE, SYSTEM_EVENT_INVALID, LAST_ADMINISTRATOR                                                         |
| S05 | Remove editor after its earlier valid task event                               | Earlier authority remains valid; future epoch has exactly remaining members; old epoch not rewritten               |
| S06 | Removed editor appends after removal                                           | CAPABILITY_DENIED; old keys do not grant write or current read                                                     |
| S07 | Removed editor appends from pre-removal parent                                 | Valid separate variant; diverged from revocation head; no automatic merge or ordering                              |
| S08 | Add reader after several removals/epochs                                       | Explicit wraps for every historical epoch; full reconstruction; unavailable author key blocks admission atomically |
| S09 | Malformed host-addressed wrap; missing/reordered/duplicate member wraps        | KEY_WRAP_INVALID / SYSTEM_EVENT_INVALID; do not certify other recipients' encrypted plaintext                      |
| S10 | System removal then application in same signed commit                          | New epoch required; actor rights evaluated per position; removed actor cannot authorize a later commit             |
| S11 | Self-removal while another administrator remains                               | SYSTEM_EVENT_INVALID; original head/projection unchanged; a different administrator can remove the identity        |
| S12 | Add identity after its removal, or disable write while retaining read          | Re-admission carries all epochs; canRead and canWrite remain independent                                           |

## B and T: board and actual package consumers

B01 replays every board command/event in the blueprint with literal before/after
projections. B02 rejects duplicate IDs, invalid movement targets, stale task references,
unknown columns, unknown assignees, malformed data, and edits to archived tasks both
at decision and reducer seams. B03 proves viewer/editor/owner presets compile to system
rules. B04 runs the full board walkthrough with saved artifacts and divergent heads.
B05 proves expected-head write checks atomically: two candidates use the same expected
head, exactly one succeeds, the other returns HEAD_CONFLICT and remains exportable.
B06 reopens publication, simulates failed write, and proves no draft persistence.

T01 checks every exported JS/types path exists in packed tarballs. T02 installs the
exact candidate set in an isolated consumer outside the workspace, imports every public
subpath, typechecks typed command success plus expected compile-time errors, and runs
the owner lifecycle. No aliases, sibling-source imports, registry predecessor fallback,
or ambient workspace hoisting. T03 imports protocol alone without loading Armour,
models, runtime, framework, or Seal; assert the dependency closure. T04 exercises
Identity/Armour standalone and both directions of native age interop. T05 runs the
Node 22/24 and pinned browser fixtures and rejects accidental Node globals in browser
outputs. T06 validates required scripts, true one-shot test failure statuses, declaration
dependencies, workspace range rewriting, assets, and release dependency order.

## Evidence and completion reporting

The supplied reference artifacts were checked with Node crypto and native age, not the
future runtime. See [the vector README](vectors/README.md) for exact coverage. Steps
0–3 are done only when every applicable P/C/R and T case passes through candidate
public imports. P13 may use the protocol helper before grouped runtime authoring exists.
D/S/B cases gate their later increments. A first-slice report must explicitly identify
the remaining profile-1 events as unimplemented; it cannot claim complete alpha
profile conformance. Complete alpha requires all cases and the board proof.

Record formatter, lint, typecheck, behavior, build, packed-consumer, and browser results
separately. Record runtime/tool versions and elapsed scope before making feedback-speed
claims. Existing legacy failures, introduced failures, and unverified checks get separate
lines. Never replace a fixed expectation with a value produced by the candidate merely
to get a passing test. Changes to vectors are protocol/model changes requiring review.

---
status: accepted
---

# Use single-head snapshots and explicit divergence

The genesis commit identifies a document lineage; every snapshot selects one head and
replays its linear parent chain. Two snapshots whose heads descend independently from
the same commit may both be valid. Concord classifies them as diverged but never orders,
combines, or silently selects between them. Alpha has no merge operation: integrations
retain both variants or ask a person to choose, while combining their meaning creates a
new document that may reference both source heads. The resolver signs that new
document's genesis and establishes its authority and audiences explicitly; security
state does not carry over from either source. This keeps signatures and attribution
honest without putting a DAG or merge engine into the protocol.

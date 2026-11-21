# Concord architecture

Protocol owns parsing, canonical bytes, IDs, signatures and linkage. Runtime owns
lifecycle and atomic publication. Standard system owns authority and private replay.
Models own application meaning. Do not reintroduce Ledger/Workspace, Seal proofs,
plugin ordering, ambient reducer clocks, or storage into the runtime. Keep protocol
imports independent of runtime, model and Armour. Historical implementations are available in Git.

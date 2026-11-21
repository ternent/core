# Concord architecture

Ledger owns the common signed container, canonical bytes, IDs, signatures, staging,
commits, verification and ordered replay. Concord composes that lifecycle with
commands, authority, encryption and atomic application-state publication. Standard
system owns authority and private replay; models own application meaning. Do not
duplicate Ledger's commit engine or add Workspace, Seal proofs, plugin ordering,
ambient reducer clocks or storage to the runtime. Keep protocol imports independent
of runtime, model and Armour. Historical implementations are available in Git.

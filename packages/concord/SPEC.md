# Concord alpha contract

The accepted ownership is [one Ledger container](../../docs/adr/0018-use-one-ledger-container-for-concord.md).
The current wire contract is [Protocol 1](../../docs/concord/alpha-protocol.md), with
[standard profile 1](../../docs/concord/standard-profile.md) defining authority and encryption.
Ledger owns the signed history lifecycle; Concord composes commands, system replay
and application replay. Current implemented scope and the alpha compatibility break
are documented in [README.md](README.md). Older implementations remain in Git.

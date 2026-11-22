---
status: accepted
---

# Keep asynchronous profile reentry a host contract

Models and system profiles are trusted host implementations. Neither may dispatch
back into the same handle while evaluating its current operation. Model callbacks
are synchronous and pure; profiles may await cryptographic operations.

The runtime rejects synchronous callback reentry with `HOST_CONFIGURATION`. It
does not hold that guard across an asynchronous profile's entire promise: doing so
would also reject legitimate external dispatches while encryption is pending,
breaking the required per-handle operation queue.

Asynchronous profiles must therefore honor the no-reentry rule after their own
awaits. The alpha runtime does not instrument host async context or promise
ownership to distinguish that invalid call from an independent caller. An async
profile that awaits its own queued dispatch can deadlock; it is a nonconforming
host implementation, not a supported failure path with guaranteed automatic
detection. The official standard profile has no handle reference and follows this
rule. Loading document bytes never loads executable profiles.

This clarifies the earlier blanket rejection promise without weakening serialized
authoring or purity for conforming extensions. Future host-context instrumentation
must preserve queued concurrent dispatch and prove behavior in Node and browser
consumers before expanding automatic detection.

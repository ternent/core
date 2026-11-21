---
status: accepted
---

# Simplify core around five libraries

Core's active workspace and release scope are Identity, Armour, Ledger, Concord and
Seal. Ledger owns one common signed container and history lifecycle; Concord composes
commands, system authority, group encryption and model replay above it. UI is outside
the library release and Workspace remains deferred. Demos belong in separate projects
consuming published libraries.

Remove the portable tooling package, tooling-profile fixtures, handshake app and
VitePress patch. Share ordinary root Vite+ and TypeScript base configs, keep explicit
package entries/outputs, and use standard pnpm recursive builds. Keep small repository
contract and consumer scripts; use standard publint for package validation instead of
a custom validator framework. This supersedes the portable-profile and Vite Task
scheduling requirements in [ADR 0010](0010-use-vite-plus-with-portable-tooling-profiles.md).

Preserve meaningful evidence for all five products: separate format/lint/type/build/
behavior gates, exact-tarball publint, fixed crypto vectors, public declarations, CLI
and import isolation, Node compatibility lanes and Chromium cryptography. Generate a
minimal Vue render/CSS consumer in a temporary directory. Retire SFC, documentation
routing, profile portability and handshake proof products; their removal does not
remove a library contract. [ADR 0013](0013-pilot-candidate-isolation.md)'s exact candidate
overrides remain the local isolation method, with final registry-range verification
still required before release.

Consolidate contributor guidance in [CONTRIBUTING.md](../../CONTRIBUTING.md) and the
[repository guide](../engineering/repository-hygiene.md). Keep the current release
contract/backlog in [release and deployment](../engineering/release-and-deployment.md).
Remove superseded reports after preserving their durable contracts and fixing links;
do not create forwarding stubs or copied legacy archives. Keep normative crypto,
group and storage contracts, vectors and durable ADR history.

Staging is intentionally in memory. Consumers own commit cadence and any persistence
or recovery of uncommitted work under [ADR 0019](0019-keep-draft-persistence-with-consumers.md).
No library draft-persistence feature is pending. Publication and account onboarding
remain separate work; this cleanup neither publishes packages nor certifies a new
acceptance run.

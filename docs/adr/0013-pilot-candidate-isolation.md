---
status: accepted
---

# Isolate R1 consumers with exact candidate overrides

For the tooling pilot, pack every candidate once and install those tarballs in a
temporary directory outside the workspace. Override every candidate name to its
exact local tarball, including transitive sibling references. Registry access may
resolve external dependencies, but cannot substitute a published predecessor for a
candidate. Record candidate SHA-256 digests with the consumer acceptance results.

This exercises public exports, declarations, CLI metadata, Vue assets, and portable
tooling without sibling-source aliases or root dependency resolution. The validator
also rejects undeclared imports in emitted JavaScript and declarations. Private
fixtures use packable manifests but never become publication candidates.

This is equivalent isolated resolution for R1, not an npm publication rehearsal.
R5 adds the temporary registry, planned release versions, packed registry metadata,
OIDC identity, and artifact-preserving publication checks specified in the release
contract. No release infrastructure is required merely to prove portable profiles.

See [implementation and limitations](../engineering/tooling-pilot.md).

---
status: accepted
---

# Publish verified artifacts through one workflow

Changesets versions independent public packages, and one GitHub Actions publisher uses
npm OIDC to publish the exact tarballs installed by isolated consumers. A digest-bound
release plan and per-package journal allow partial releases to resume without rebuilding
or overwriting a version. Tags are evidence of successful publication rather than a
second publisher trigger. This trades a small artifact handoff for confidence that
published bytes match reviewed checks; npm release sets remain explicitly non-atomic.
See [the release contract](../engineering/release-and-deployment.md).

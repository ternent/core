---
status: accepted
---

# Use Vite+ with portable tooling profiles

The portable-profile, product-scope and scheduling details below are superseded by
[ADR 0020](0020-simplify-core-around-five-libraries.md). pnpm and project-local Vite+
remain selected; ordinary repository configs replace the published tooling module.
The text below records the original decision.

Rebuild the monorepo around pnpm and project-local Vite+, with independently versioned
Identity, Armour, Seal, Concord, UI, and a portable development-only tooling module.
The tooling module owns a few tested library/CLI/Vue/app/docs profiles; package manifests
own public metadata and Vite Task owns scheduling. This replaces copied per-package
configurations and legacy Ledger/Workspace seams without introducing another build
system. Plain executable ESM tooling is an explicit bootstrap exception to compiled
library outputs. Experimental tsrs stays a comparison lane until diagnostic, consumer,
and repository performance evidence supports promotion. See
[the current repository guide](../engineering/repository-hygiene.md).

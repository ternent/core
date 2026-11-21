---
status: accepted
---

# Use Vite+ with portable tooling profiles

Rebuild the monorepo around pnpm and project-local Vite+, with independently versioned
Identity, Armour, Seal, Concord, UI, and a portable development-only tooling module.
The tooling module owns a few tested library/CLI/Vue/app/docs profiles; package manifests
own public metadata and Vite Task owns scheduling. This replaces copied per-package
configurations and legacy Ledger/Workspace seams without introducing another build
system. Plain executable ESM tooling is an explicit bootstrap exception to compiled
library outputs. Experimental tsrs stays a comparison lane until diagnostic, consumer,
and repository performance evidence supports promotion. See
[the repository design](../engineering/repository-architecture.md).

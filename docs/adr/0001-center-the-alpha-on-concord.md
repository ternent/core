---
status: accepted
---

# Center the alpha on Concord

Keep the code in one monorepo, but make `@ternent/concord` the primary developer-facing
package with protocol, system, and testing subpaths. Identity, Armour, and Seal remain
independently consumable because they have real standalone uses; Ledger mechanics and
the former Workspace runtime stay internal until an independent consumer justifies a
public boundary. This avoids cross-repository coordination and package seams inherited
from the unfinished migration while preserving extraction paths.

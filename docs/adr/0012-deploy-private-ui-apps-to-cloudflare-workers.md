---
status: accepted
---

# Deploy private UI applications to Cloudflare Workers Static Assets

Publish libraries/components to npm and deploy their private application consumers to
Cloudflare through one GitHub-controlled Wrangler workflow. New stateless UI apps use
Workers Static Assets with explicit Preview configuration and verified immutable asset
bundles; Cloudflare hosting does not introduce a Concord backend or storage dependency.
Separate deployment receipts, environments, and rollback from package versioning so
an application change need not publish its libraries. Prefer this single deployment
family over parallel Pages/Workers build pipelines for the clean target. See
[deployment semantics](../engineering/release-and-deployment.md).

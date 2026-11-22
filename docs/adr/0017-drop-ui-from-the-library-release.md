---
status: accepted
---

# Drop the maintained UI package from the library release

On 2026-11-21, Sam accepted removing `@ternent/ui` from the v1 release requirements.
The design-system package was an earlier decision and does not justify ongoing
maintenance by itself.

The public release contains five products: Identity, Armour, Concord, Seal and
portable Tooling. UI migration tasks B08–B10 are cancelled. Their work is not a
prerequisite for package verification, publishing or demos. This supersedes the
six-product boundary and UI-product requirements in earlier architecture documents.

Keep the existing excluded UI sources available as reference. No UI source migration,
new package or replacement design system is required by this decision. Portable
Vue build profiles and consumer fixtures remain useful verification of the tooling
and browser-facing libraries; they do not imply a public UI product.

When building demos, choose a maintained component foundation, a small visual brief
and theme, and application components shaped by the actual demo. Review generated
UI through browser behavior and accessibility checks. Extract shared components
only when repeated use establishes a need; do not prebuild another component library.

Next: complete isolated candidate-registry verification (B13), then release planning,
workflow integration and published consumption proof (B14–B16). Workspace remains
deferred until the libraries run smoothly and plenty of demos exist.

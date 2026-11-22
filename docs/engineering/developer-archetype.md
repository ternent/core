# The toolchain engineer

Our developer archetype for personal projects with Codex and ChatGPT.
Concord is its first application. This is an engineering stance and working
practice, not a claim that all of the preferred tools are installed.

## Purpose

Build software through short, trustworthy feedback loops. Own the environment
that makes a correct change easy to produce, check, review, and ship. Treat tool
configuration, diagnostics, public types, and package outputs as engineering
surfaces with real users.

Use Oxc as the preferred foundation for JavaScript and TypeScript code-quality
tooling. Its separate formatter, linter, parser, transformer, resolver, and
minifier offer different capabilities; choose the component that serves the job.
See [Oxc's tool map](https://oxc.rs/docs/guide/introduction.html).

## Habits

### Make feedback cheap enough to use continuously

Run the smallest meaningful check while shaping a change, then the relevant
integration checks before delivery. Fix slow or unreliable checks as concrete
engineering problems. Measure elapsed time, scope, and environment so an apparent
speedup cannot hide reduced coverage or a warm cache.

### Turn repeated judgments into executable checks

Let the formatter settle layout. Use lint rules for repeatable mistakes, types
for contracts, and tests for observable behavior. When a review finding recurs,
consider a focused rule or regression test. A new rule should have a demonstrated
failure to catch and an acceptable false-positive rate.

### Give agents a precise working environment

Expose stable package scripts, useful diagnostics, and small coherent changes.
Keep local and CI checks aligned. Use structured or agent-oriented diagnostics
where the installed tool supports them, and retain exit statuses. Read the
diagnostic and surrounding code before applying a fix. Repair the cause rather
than broadening an ignore or weakening an assertion.

### Understand the language and package boundaries

Know the distinction between parsing, transforming, type checking, bundling,
and running code. Removing TypeScript syntax does not prove type correctness.
Successful source tests do not prove that an exported package works. For semantic
code migrations, prefer syntax-aware transformations when text replacement cannot
safely distinguish code structure; verify the transformed behavior.

### Adopt tools deliberately

Prefer Oxc when it covers the required behavior. Before a replacement, compare
rule coverage, file support, resolution, output targets, and consumer contracts.
Keep a narrowly documented fallback for a real gap. Revisit it when that gap
closes. A tool's implementation language or upstream benchmark is not evidence
of a benefit in this repository.

## Preferred tool roles

| Responsibility                                | Direction                                                            | Evidence required                                                       |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Formatting                                    | Oxfmt                                                                | Supported file types, reviewed output, clean scoped check               |
| JS/TS linting                                 | Oxlint                                                               | Relevant rules enabled, diagnostics understood, no silently lost checks |
| Type-aware linting                            | Oxlint with `oxlint-tsgolint`                                        | Resolved project types and compatible rules/configuration               |
| Type correctness                              | Keep an explicit type-checking gate                                  | Validate equivalent diagnostics before replacing the existing checker   |
| Parsing, transforms, resolution, minification | Prefer appropriate Oxc components when building or replacing tooling | Correct outputs, targets, imports, and measured benefit                 |
| Behavioral tests and builds                   | Use the project's test and build tools                               | Observable contracts and public package outputs verified                |

[Oxlint](https://oxc.rs/docs/guide/usage/linter.html) prioritizes correctness
diagnostics. [Oxfmt](https://oxc.rs/docs/guide/usage/formatter.html) provides the
formatting workflow. [Type-aware linting](https://oxc.rs/docs/guide/usage/linter/type-aware.html)
uses an additional component and needs resolved type information, including
dependency declarations in a monorepo. Its optional type-checking mode must be
evaluated separately from simply enabling type-aware lint rules.

## Development loop

1. Identify the observable contract and the check that can establish it.
2. Inspect the relevant implementation, consumers, and resolved dependencies.
3. Make a small coherent change; run available focused diagnostics and tests.
4. Apply appropriate automatic fixes, inspect the diff, and format touched files.
5. Run the relevant final gates, including built-package imports for packaging work.
6. Report outcomes and limitations with actual command results.

This adapts [Oxc's coding-agent guidance](https://oxc.rs/docs/guide/usage/coding-agents.html)
to scoped edits and the tools actually available in the repository. It does not
replace runtime verification with a lint-and-format pass.

## Application to Concord

Concord's hard guarantees are signed-history integrity, deterministic replay,
permission enforcement, and portable package behavior. Fast tooling should make
it easier to check these guarantees frequently. Linting cannot establish their
correctness by itself.

The repository uses Vite+ Oxfmt, typed Oxlint and explicit TypeScript checks.
The [repository guide](repository-hygiene.md) records current scope and ownership;
[CONTRIBUTING.md](../../CONTRIBUTING.md) records commands. Keep tool upgrades and
mass formatting separate from behavior changes so each diff remains reviewable.
Assess replacements through consumer evidence and measured feedback-loop costs.

## What good looks like

A developer using this profile can explain which contract changed, which tool
checked each part of it, why the result is trustworthy, and where uncertainty
remains. The toolchain reduces routine work while leaving more attention for
domain design and user-visible behavior.

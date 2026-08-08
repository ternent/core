# `@ternent/workspace`

Framework-agnostic secure runtime for Ternent and Concord applications.

## Install

```bash
pnpm add @ternent/workspace
```

## Usage

```ts
import { createRuntimeCore } from "@ternent/workspace";

const runtime = createRuntimeCore({
  storage,
});

await runtime.load();
await runtime.users.create({ identityKey: "did:key:z..." });
await runtime.permissions.createGroup({ title: "Editors" });
await runtime.commit();
```

## Scope

`@ternent/workspace` owns the reusable runtime contract:

- identity bootstrap, unlock, lock, and recovery
- Concord load, command, commit, discard, and replay
- ledger create, export, and import
- native `users` and `permissions` modules
- plugin registration, selectors, and subscriptions

Framework adapters and demo shells sit above this package.

Plugin authoring helpers are exported from the same package root.

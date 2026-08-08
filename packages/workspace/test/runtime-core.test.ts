import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createIdentity } from "@ternent/identity";
import type { LedgerContainer } from "@ternent/ledger";
import {
  buildWorkspaceExportFile,
  createConcordLocalStorageAdapter,
  createLocalWorkspace,
  createRuntimeCore,
  parseWorkspaceImportJson,
  readWorkspaceSummary,
  reopenCurrentWorkspace,
  type AppProjectionPlugin,
  type LocalStorageLike,
} from "../src";

function createMemoryStorage(): LocalStorageLike {
  const records = new Map<string, string>();
  return {
    getItem(key) {
      return records.get(key) ?? null;
    },
    setItem(key, value) {
      records.set(key, value);
    },
    removeItem(key) {
      records.delete(key);
    },
  };
}

function responseJson(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    status: init?.status ?? 200,
  });
}

function createProbeConflictPlugin(): AppProjectionPlugin<{ entryIds: string[] }> {
  return {
    plugin: {
      id: "probe-conflict",
      initialState: () => ({ entryIds: [] }),
      commands: {
        "probe-conflict.write": async (_ctx, inputValue) => {
          const value = inputValue as {
            aggregateId: string;
            field: string;
            baseRevision: string;
            actorIdentityKey: string;
            permissionId?: string | null;
          };
          const runtimeConflict: Record<string, unknown> = {
            aggregateId: value.aggregateId,
            fields: [value.field],
            baseRevision: value.baseRevision,
            actorIdentityKey: value.actorIdentityKey,
          };
          const payload: Record<string, unknown> = {
            aggregateId: value.aggregateId,
            actorIdentityKey: value.actorIdentityKey,
            _runtimeConflict: runtimeConflict,
          };

          if (typeof value.permissionId === "string" && value.permissionId.length > 0) {
            runtimeConflict.permissionId = value.permissionId;
            payload.permissionId = value.permissionId;
          }

          return {
            kind: "probe-conflict.write",
            payload,
          };
        },
      },
      applyEntry(entry, ctx) {
        if (entry.kind !== "probe-conflict.write") {
          return;
        }

        const state = ctx.getState();
        ctx.setState({
          entryIds: [...state.entryIds, entry.entryId],
        });
      },
    },
    selectors: {
      entryIds(state) {
        return state.entryIds;
      },
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("@ternent/workspace runtime core", () => {
  it("boots with native users and permissions only by default", async () => {
    const storage = createMemoryStorage();
    const core = createRuntimeCore({
      identity: await createIdentity("2026-07-08T10:00:00.000Z"),
      storage: createConcordLocalStorageAdapter({
        storage,
        storageKey: "test/workspace-runtime/native-only",
      }),
    });

    await core.load();

    expect(core.getStatus()).toBe("ready");
    expect(core.users.all()).toHaveLength(1);
    expect(core.permissions.all()).toHaveLength(0);
    expect(() => core.select("tasks", "all")).toThrow("Unknown plugin id 'tasks'");
  });

  it("supports extra plugins without changing the core surface", async () => {
    const storage = createMemoryStorage();
    const probePlugin: AppProjectionPlugin<{ count: number }> = {
      plugin: {
        id: "probe",
        initialState: () => ({ count: 0 }),
        commands: {
          "probe.increment": async () => ({
            kind: "probe.increment",
            payload: {
              step: 1,
            },
          }),
        },
        applyEntry(entry, ctx) {
          if (entry.kind !== "probe.increment") {
            return;
          }

          const state = ctx.getState();
          ctx.setState({
            count: state.count + 1,
          });
        },
      },
      selectors: {
        count(state) {
          return state.count;
        },
      },
    };

    const core = createRuntimeCore({
      identity: await createIdentity("2026-07-08T10:05:00.000Z"),
      storage: createConcordLocalStorageAdapter({
        storage,
        storageKey: "test/workspace-runtime/extra-plugin",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });

    await core.load();
    await core.command("probe.increment", {});

    expect(core.select<number>("probe", "count")).toBe(1);
  });

  it("keeps workspace lifecycle helpers package-owned and runtime-native", async () => {
    const storage = createMemoryStorage();
    const core = createRuntimeCore({
      identity: await createIdentity("2026-07-08T10:07:00.000Z"),
      storage: createConcordLocalStorageAdapter({
        storage,
        storageKey: "test/workspace-runtime/lifecycle-helpers",
      }),
    });

    await core.load();
    await createLocalWorkspace(core, {
      source: "workspace-package-test",
    });
    await core.commit();

    const summary = await readWorkspaceSummary(core);
    expect(summary.providerId).toBe("local");
    expect(summary.entryCount).toBeGreaterThan(0);
    expect(summary.head).toBeTruthy();

    const exported = await core.exportLedger();
    const exportedFile = buildWorkspaceExportFile(exported, "workspace-runtime");
    const reparsed = parseWorkspaceImportJson(exportedFile.content);
    expect(reparsed.head).toBe(exported.head);

    await core.command("permission.create", {
      title: "Discard on reopen",
      actor: {
        memberId: core.getActiveIdentity()!.identityKey,
        memberLabel: core.getActiveIdentity()!.label,
      },
    });
    expect(core.getState().stagedCount).toBeGreaterThan(0);

    await reopenCurrentWorkspace(core);

    expect(core.getState().stagedCount).toBe(0);
    const reopened = await core.exportLedger();
    expect(reopened.head).toBe(exported.head);
  });

  it("publishes snapshot updates and keeps vue out of the extracted package", async () => {
    const storage = createMemoryStorage();
    const probePlugin: AppProjectionPlugin<{ count: number }> = {
      plugin: {
        id: "probe-snapshot",
        initialState: () => ({ count: 0 }),
        commands: {
          "probe-snapshot.increment": async () => ({
            kind: "probe-snapshot.increment",
            payload: { step: 1 },
          }),
        },
        applyEntry(entry, ctx) {
          if (entry.kind !== "probe-snapshot.increment") {
            return;
          }

          const current = ctx.getState();
          ctx.setState({
            count: current.count + 1,
          });
        },
      },
      selectors: {
        count(state) {
          return state.count;
        },
      },
    };

    const core = createRuntimeCore({
      identity: await createIdentity("2026-07-08T10:10:00.000Z"),
      storage: createConcordLocalStorageAdapter({
        storage,
        storageKey: "test/workspace-runtime/subscribe",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    const snapshots: Array<{ status: string; stagedCount: number }> = [];

    const unsubscribe = core.subscribe((snapshot) => {
      snapshots.push({
        status: snapshot.status,
        stagedCount: snapshot.state.stagedCount,
      });
    });

    await core.load();
    await core.command("probe-snapshot.increment", {});
    unsubscribe();

    expect(snapshots.some((snapshot) => snapshot.status === "ready")).toBe(true);
    expect(snapshots.at(-1)?.stagedCount).toBeGreaterThan(0);

    const packageSources = [
      "src/index.ts",
      "src/runtimeCore/index.ts",
      "src/runtimeCore/types.ts",
      "src/runtimeCore/helpers.ts",
      "src/runtimeCore/createRuntimeCore.ts",
      "src/runtimeCore/sections/shared.ts",
      "src/runtimeCore/sections/users.ts",
      "src/runtimeCore/sections/permissions.ts",
      "src/runtimeCore/sections/identity.ts",
      "src/plugins/index.ts",
    ];

    for (const path of packageSources) {
      const contents = readFileSync(resolve(process.cwd(), path), "utf8");
      expect(contents).not.toMatch(/from "vue"/);
      expect(contents).not.toMatch(/from 'vue'/);
    }
  });

  it("rejects same-aggregate conflicts for non-task plugins through runtime metadata alone", async () => {
    const identity = await createIdentity("2026-07-09T10:00:00.000Z");
    const probePlugin = createProbeConflictPlugin();
    const baseCore = createRuntimeCore({
      identity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-conflict-base",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });

    await baseCore.load();
    const baseLedger = await baseCore.exportLedger();

    const remoteCore = createRuntimeCore({
      identity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-conflict-remote",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await remoteCore.load();
    await remoteCore.importLedger(baseLedger);
    await remoteCore.command("probe-conflict.write", {
      aggregateId: "aggregate-1",
      field: "title",
      baseRevision: "base-revision-1",
      actorIdentityKey: remoteCore.getActiveIdentity()!.identityKey,
    });
    await remoteCore.commit();

    let remoteContainer: LedgerContainer = await remoteCore.exportLedger();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return responseJson(remoteContainer, {
          headers: {
            etag: remoteContainer.head,
          },
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body && body.container) {
        remoteContainer = body.container as LedgerContainer;
      }

      return responseJson({ container: remoteContainer }, {
        headers: {
          etag: remoteContainer.head,
        },
      });
    });

    const syncedCore = createRuntimeCore({
      identity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-conflict-synced",
      }),
      workspaceStorageRef: {
        providerId: "http",
        workspaceId: "workspace-probe-conflict",
        pointer: "https://example.test/workspace/probe-conflict",
      },
      storageSync: {
        providerId: "http",
        mode: "shared",
        supportsCompareAndSwap: true,
      },
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await syncedCore.load();
    await syncedCore.importLedger(baseLedger);
    await syncedCore.command("probe-conflict.write", {
      aggregateId: "aggregate-1",
      field: "title",
      baseRevision: "base-revision-1",
      actorIdentityKey: syncedCore.getActiveIdentity()!.identityKey,
    });

    const result = await syncedCore.commit();

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBe("conflict");
      expect(result.conflicts.some((conflict) => conflict.kind === "same-aggregate-field-conflict")).toBe(
        true,
      );
    }
  });

  it("rejects write-after-revoke for non-task plugins that target a permission audience", async () => {
    const ownerIdentity = await createIdentity("2026-07-09T11:00:00.000Z");
    const guestIdentity = await createIdentity("2026-07-09T11:05:00.000Z");
    const probePlugin = createProbeConflictPlugin();
    const guestSeedCore = createRuntimeCore({
      identity: guestIdentity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-revoke-guest-seed",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await guestSeedCore.load();
    const guestIdentityKey = guestSeedCore.getActiveIdentity()!.identityKey;

    const ownerCore = createRuntimeCore({
      identity: ownerIdentity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-revoke-owner",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await ownerCore.load();
    await ownerCore.users.create({ identityKey: guestIdentityKey });
    await ownerCore.permissions.create({ title: "Shared Permission" });
    const permissionId = ownerCore.permissions.all().at(0)?.id;
    expect(permissionId).toBeTruthy();
    await ownerCore.permissions.grant({ permissionId: permissionId!, memberId: guestIdentityKey });
    await ownerCore.commit();

    const baseLedger = await ownerCore.exportLedger();

    const remoteOwnerCore = createRuntimeCore({
      identity: ownerIdentity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-revoke-remote-owner",
      }),
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await remoteOwnerCore.load();
    await remoteOwnerCore.importLedger(baseLedger);
    await remoteOwnerCore.permissions.revoke({ permissionId: permissionId!, memberId: guestIdentityKey });
    await remoteOwnerCore.commit();

    let remoteContainer: LedgerContainer = await remoteOwnerCore.exportLedger();

    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const method = (init?.method ?? "GET").toUpperCase();
      if (method === "GET") {
        return responseJson(remoteContainer, {
          headers: {
            etag: remoteContainer.head,
          },
        });
      }

      const body = init?.body ? JSON.parse(String(init.body)) : null;
      if (body && body.container) {
        remoteContainer = body.container as LedgerContainer;
      }

      return responseJson({ container: remoteContainer }, {
        headers: {
          etag: remoteContainer.head,
        },
      });
    });

    const guestSyncedCore = createRuntimeCore({
      identity: guestIdentity,
      storage: createConcordLocalStorageAdapter({
        storage: createMemoryStorage(),
        storageKey: "test/workspace-runtime/probe-revoke-guest-synced",
      }),
      workspaceStorageRef: {
        providerId: "http",
        workspaceId: "workspace-probe-revoke",
        pointer: "https://example.test/workspace/probe-revoke",
      },
      storageSync: {
        providerId: "http",
        mode: "shared",
        supportsCompareAndSwap: true,
      },
      createExtraPlugins() {
        return [probePlugin];
      },
    });
    await guestSyncedCore.load();
    await guestSyncedCore.importLedger(baseLedger);
    await guestSyncedCore.command("probe-conflict.write", {
      aggregateId: "aggregate-2",
      field: "body",
      baseRevision: "base-revision-2",
      actorIdentityKey: guestIdentityKey,
      permissionId,
    });

    const result = await guestSyncedCore.commit();

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toBe("conflict");
      expect(result.conflicts.some((conflict) => conflict.kind === "write-after-revoke")).toBe(true);
    }
  });
});

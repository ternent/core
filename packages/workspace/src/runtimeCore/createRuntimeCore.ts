import {
  createConcordLocalStorageAdapter,
  createApp as createRuntimeApp,
  createIdentityService,
  type IdentityBootstrapMode,
} from "../runtime";
import { createPermissionsPlugin, createRuntimeReplayContext, createUsersPlugin } from "../plugins";
import type { AppProjectionPlugin, AppRuntime } from "../runtime";
import type {
  RuntimeCore,
  RuntimeCoreIdentity,
  RuntimeCoreSnapshot,
  RuntimeCoreStatus,
  CreateRuntimeCoreOptions,
} from "./types";
import {
  buildPermissionActor,
  createInitialState,
  ensureCreatorUserBootstrap,
  requireActiveIdentity,
  requireProjectedUser,
  requireSelector,
  toErrorMessage,
  toRuntimeCoreIdentity,
} from "./helpers";
import { createRuntimeCoreIdentityApi } from "./sections/identity";
import { createRuntimeCorePermissionsApi } from "./sections/permissions";
import { createRuntimeCoreUsersApi } from "./sections/users";

function createDefaultPlugins(
  options: CreateRuntimeCoreOptions | undefined,
  replayContext: ReturnType<typeof createRuntimeReplayContext>,
): AppProjectionPlugin<any>[] {
  if (options?.plugins) {
    return options.plugins;
  }

  return [
    createUsersPlugin(),
    createPermissionsPlugin({ replayContext }),
    ...(options?.createExtraPlugins?.({ replayContext }) ?? []),
  ];
}

export function createRuntimeCore(options?: CreateRuntimeCoreOptions): RuntimeCore {
  const replayContext = createRuntimeReplayContext();
  const plugins = createDefaultPlugins(options, replayContext);
  const listeners = new Set<(snapshot: RuntimeCoreSnapshot) => void>();

  let status: RuntimeCoreStatus = "restoring";
  let state = createInitialState(plugins);
  let lastError: string | null = null;
  let activeIdentity: RuntimeCoreIdentity | null = null;
  let runtime: AppRuntime | null = null;
  let runtimeSubscription: (() => void) | null = null;
  let identityService: ReturnType<typeof createIdentityService> | null = null;
  let bootstrapPromise: Promise<void> | null = null;

  function getSnapshot(): RuntimeCoreSnapshot {
    return {
      status,
      state,
      lastError,
      activeIdentity,
    };
  }

  function notify(): void {
    const snapshot = getSnapshot();
    for (const listener of listeners) {
      listener(snapshot);
    }
  }

  function ensureIdentityService() {
    if (identityService) {
      return identityService;
    }

    identityService = createIdentityService({
      identity: options?.identity,
      encryptedIdentity: options?.encryptedIdentity,
      identityBootstrapMode: options?.identityBootstrapMode,
      storage: options?.identityStorage,
      storageKey: options?.identityStorageKey,
      devSessionUnlockBypass: options?.devSessionUnlockBypass ?? import.meta.env.DEV,
      rpName: options?.rpName,
    });

    return identityService;
  }

  async function teardownRuntime(): Promise<void> {
    if (runtimeSubscription) {
      runtimeSubscription();
      runtimeSubscription = null;
    }

    if (runtime) {
      await runtime.destroy();
      runtime = null;
    }

    bootstrapPromise = null;
    replayContext.endReplayPipeline();
    replayContext.clearDecryptedPayloadCache();
    state = createInitialState(plugins);
    status = "restoring";
    lastError = null;
    activeIdentity = null;
    notify();
  }

  async function bootstrap(mode?: IdentityBootstrapMode): Promise<void> {
    if (runtime) {
      return;
    }

    status = "restoring";
    lastError = null;
    notify();

    try {
      const resolvedIdentity = await ensureIdentityService().ensureUnlocked(mode);

      activeIdentity = toRuntimeCoreIdentity({
        identityId: resolvedIdentity.identityId,
        label: resolvedIdentity.label,
        publicKey: resolvedIdentity.identity.publicKey,
      });

      const storage =
        options?.storage ??
        createConcordLocalStorageAdapter({
          storage: options?.concordStorage,
          storageKey: options?.concordStorageKey,
        });

      runtime = await createRuntimeApp({
        identity: resolvedIdentity.identity,
        storage,
        plugins,
        replayContext,
        workspaceStorageRef: options?.workspaceStorageRef,
        storageSync: options?.storageSync ?? null,
      });

      runtimeSubscription = runtime.subscribe((nextState) => {
        state = nextState;
        notify();
      });

      await runtime.loadWithReplayPipeline();
      await ensureCreatorUserBootstrap(runtime, activeIdentity);

      state = runtime.getState();
      status = "ready";
      lastError = null;
      notify();
    } catch (error) {
      replayContext.endReplayPipeline();
      status = "error";
      lastError = toErrorMessage(error);
      notify();
      throw error;
    }
  }

  async function ensureRuntime(): Promise<AppRuntime> {
    if (!bootstrapPromise) {
      bootstrapPromise = bootstrap();
    }

    await bootstrapPromise;

    if (!runtime) {
      throw new Error("App runtime is unavailable.");
    }

    return runtime;
  }

  async function executeMutation<T>(task: () => Promise<T>): Promise<T> {
    try {
      const result = await task();
      lastError = null;
      notify();
      return result;
    } catch (error) {
      lastError = toErrorMessage(error);
      notify();
      throw error;
    }
  }

  let api!: RuntimeCore;

  const users = createRuntimeCoreUsersApi({
    command: (type, input) => api.command(type, input),
    select: (pluginId, selectorId, ...args) => api.select(pluginId, selectorId, ...args),
    getPluginState: (pluginId) => api.getPluginState(pluginId),
    activeIdentity: () => activeIdentity,
    requireActiveIdentity,
  });

  const permissions = createRuntimeCorePermissionsApi({
    command: (type, input) => api.command(type, input),
    select: (pluginId, selectorId, ...args) => api.select(pluginId, selectorId, ...args),
    getPluginState: (pluginId) => api.getPluginState(pluginId),
    activeIdentity: () => activeIdentity,
    requireActiveIdentity,
    buildPermissionActor,
    requireProjectedUser,
  });

  api = {
    identity: createRuntimeCoreIdentityApi({
      getStatus: () => status,
      getActiveIdentity: () => activeIdentity,
      ensureRuntime,
      bootstrap,
      teardownRuntime,
      ensureIdentityService,
    }),
    users,
    permissions,
    storage: {
      listProviders() {
        return executeMutation(async () => {
          const resolvedRuntime = await ensureRuntime();
          return resolvedRuntime.listStorageProviders().map((provider) => ({
            id: provider.id,
            label: provider.label,
            capabilities: { ...provider.capabilities },
          }));
        });
      },
      getActiveRef() {
        return executeMutation(async () => {
          const resolvedRuntime = await ensureRuntime();
          return resolvedRuntime.getActiveStorageRef();
        });
      },
      setActiveRef(ref) {
        return executeMutation(async () => {
          const resolvedRuntime = await ensureRuntime();
          resolvedRuntime.setActiveStorageRef(ref);
        });
      },
      configureProvider(input) {
        return executeMutation(async () => {
          const resolvedRuntime = await ensureRuntime();
          resolvedRuntime.configureStorageSync(input.sync, input.ref);
        });
      },
      getCapabilities(providerId) {
        return executeMutation(async () => {
          const resolvedRuntime = await ensureRuntime();
          return resolvedRuntime.getStorageCapabilities(providerId);
        });
      },
    },
    getStatus() {
      return status;
    },
    getLastError() {
      return lastError;
    },
    getActiveIdentity() {
      return activeIdentity;
    },
    getSnapshot,
    load() {
      return ensureRuntime().then(() => undefined);
    },
    reopen() {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        await resolvedRuntime.reopen();
      });
    },
    command(type, input) {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        return await resolvedRuntime.commandWithReplay(type, input);
      });
    },
    commit(input) {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        return await resolvedRuntime.commitWithReplay(input);
      });
    },
    discard() {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        await resolvedRuntime.discardWithReplay();
      });
    },
    replay(optionsValue) {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        await resolvedRuntime.replayPipeline({
          replay: optionsValue,
        });
      });
    },
    createLedger(metadata) {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        await resolvedRuntime.concord.create({
          metadata,
        });
        await resolvedRuntime.replayPipeline();
        await ensureCreatorUserBootstrap(resolvedRuntime, activeIdentity);
      });
    },
    exportLedger() {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        return await resolvedRuntime.concord.exportLedger();
      });
    },
    importLedger(container) {
      return executeMutation(async () => {
        const resolvedRuntime = await ensureRuntime();
        await resolvedRuntime.importWithReplay(container);
      });
    },
    getState() {
      return state;
    },
    getPluginState<TState = unknown>(pluginId: string): TState {
      return (state.replay[pluginId] as TState) ?? ({} as TState);
    },
    select<TValue = unknown>(pluginId: string, selectorId: string, ...args: unknown[]) {
      const selector = requireSelector(plugins, pluginId, selectorId);
      const pluginState = state.replay[pluginId] as unknown;
      return selector(pluginState, ...args) as TValue;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    async destroy() {
      listeners.clear();
      await teardownRuntime();
    },
  };

  return api;
}

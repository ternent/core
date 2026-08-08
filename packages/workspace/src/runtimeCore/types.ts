import type {
  ConcordApp,
  ConcordCommandResult,
  ConcordCommitInput,
  ConcordState,
} from "@ternent/concord";
import type { SerializedIdentity } from "@ternent/identity";
import type {
  PermissionCreateInput,
  PermissionGrantInput,
  PermissionRecord,
  PermissionRevokeInput,
  UserCreateInput,
  UserRecord,
} from "../plugins";
import type { RuntimeReplayContext } from "../plugins/replayContext";
import type {
  AppProjectionPlugin,
  CreateAppInput,
  EncryptedIdentityBlobV2,
  IdentityBootstrapMode,
  IdentityOnboardingDraft,
  LocalStorageLike,
  RuntimeCommitResult,
  RuntimeReplayOptions,
  RuntimeStorageCapabilities,
  RuntimeStorageSyncOptions,
  StoredIdentitySummary,
  WorkspaceStorageRef,
} from "../runtime";

export type RuntimeCoreStatus = "restoring" | "ready" | "error";

export type RuntimeCoreIdentity = {
  identityId: string;
  identityKey: string;
  label: string;
};

export type RuntimeCorePluginFactoryInput = {
  replayContext: RuntimeReplayContext;
};

export type CreateRuntimeCoreOptions = {
  identity?: SerializedIdentity;
  encryptedIdentity?: EncryptedIdentityBlobV2 | string;
  identityBootstrapMode?: IdentityBootstrapMode;
  identityStorage?: LocalStorageLike;
  identityStorageKey?: string;
  devSessionUnlockBypass?: boolean;
  rpName?: string;
  concordStorage?: LocalStorageLike;
  concordStorageKey?: string;
  storage?: CreateAppInput["storage"];
  workspaceStorageRef?: WorkspaceStorageRef;
  storageSync?: RuntimeStorageSyncOptions | null;
  plugins?: AppProjectionPlugin<any>[];
  createExtraPlugins?: (input: RuntimeCorePluginFactoryInput) => AppProjectionPlugin<any>[];
};

export type RuntimeCoreSnapshot = {
  status: RuntimeCoreStatus;
  state: Readonly<ConcordState>;
  lastError: string | null;
  activeIdentity: RuntimeCoreIdentity | null;
};

export type RuntimeCoreIdentityApi = {
  getStatus(): RuntimeCoreStatus;
  getActiveIdentity(): RuntimeCoreIdentity | null;
  ensureActiveIdentity(): Promise<RuntimeCoreIdentity>;
  ensureUnlocked(mode?: IdentityBootstrapMode): Promise<RuntimeCoreIdentity>;
  lock(): Promise<void>;
  createOnboardingDraft(input?: {
    words?: 12 | 24;
    totpIssuer?: string;
    totpAccountName?: string;
  }): Promise<IdentityOnboardingDraft>;
  completeOnboarding(input: {
    draft: IdentityOnboardingDraft;
    password: string;
    confirmPassword: string;
    mnemonicConfirmed: boolean;
    mfaEnabled: boolean;
    totpCode?: string;
  }): Promise<RuntimeCoreIdentity>;
  recoverFromMnemonic(input: {
    mnemonic: string;
    password: string;
    confirmPassword: string;
    mfaEnabled: boolean;
    totpSecretBase32?: string;
    totpCode?: string;
    totpIssuer?: string;
    totpAccountName?: string;
    createdAt?: string;
  }): Promise<RuntimeCoreIdentity>;
  unlockWithPassword(input: { password: string; totpCode?: string }): Promise<RuntimeCoreIdentity>;
  getStoredIdentitySummary(): StoredIdentitySummary | null;
};

export type RuntimeCoreUsersApi = {
  create(input: Omit<UserCreateInput, "actorIdentityKey">): Promise<ConcordCommandResult>;
  all(): UserRecord[];
  byIdentityKey(identityKey: string): UserRecord | null;
};

export type RuntimeCorePermissionsApi = {
  create(input: Omit<PermissionCreateInput, "actor">): Promise<ConcordCommandResult>;
  createGroup(input: Omit<PermissionCreateInput, "actor">): Promise<ConcordCommandResult>;
  grant(input: Omit<PermissionGrantInput, "actor">): Promise<ConcordCommandResult>;
  issueGrant(input: Omit<PermissionGrantInput, "actor">): Promise<ConcordCommandResult>;
  grantFromUser(input: { permissionId: string; identityKey: string }): Promise<ConcordCommandResult>;
  revoke(input: Omit<PermissionRevokeInput, "actor">): Promise<ConcordCommandResult>;
  all(): PermissionRecord[];
  byId(permissionId: string): PermissionRecord | null;
};

export type RuntimeCoreStorageProviderInfo = {
  id: string;
  label: string;
  capabilities: RuntimeStorageCapabilities;
};

export type RuntimeCoreStorageApi = {
  listProviders(): Promise<RuntimeCoreStorageProviderInfo[]>;
  getActiveRef(): Promise<WorkspaceStorageRef>;
  setActiveRef(ref: WorkspaceStorageRef): Promise<void>;
  configureProvider(input: {
    sync: RuntimeStorageSyncOptions;
    ref?: WorkspaceStorageRef;
  }): Promise<void>;
  getCapabilities(providerId?: string): Promise<RuntimeStorageCapabilities | null>;
};

export type RuntimeCore = {
  identity: RuntimeCoreIdentityApi;
  users: RuntimeCoreUsersApi;
  permissions: RuntimeCorePermissionsApi;
  storage: RuntimeCoreStorageApi;
  getStatus(): RuntimeCoreStatus;
  getLastError(): string | null;
  getActiveIdentity(): RuntimeCoreIdentity | null;
  getSnapshot(): RuntimeCoreSnapshot;
  load(): Promise<void>;
  reopen(): Promise<void>;
  command<TInput = unknown>(type: string, input: TInput): Promise<ConcordCommandResult>;
  commit(input?: ConcordCommitInput): Promise<RuntimeCommitResult>;
  discard(): Promise<void>;
  replay(options?: RuntimeReplayOptions): Promise<void>;
  createLedger(metadata?: Record<string, unknown>): Promise<void>;
  exportLedger(): Promise<Awaited<ReturnType<ConcordApp["exportLedger"]>>>;
  importLedger(
    container: Awaited<ReturnType<ConcordApp["exportLedger"]>>,
  ): Promise<void>;
  getState(): Readonly<ConcordState>;
  getPluginState<TState = unknown>(pluginId: string): TState;
  select<TValue = unknown>(pluginId: string, selectorId: string, ...args: unknown[]): TValue;
  subscribe(listener: (snapshot: RuntimeCoreSnapshot) => void): () => void;
  destroy(): Promise<void>;
};

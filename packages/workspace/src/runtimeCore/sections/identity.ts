import type {
  IdentityBootstrapMode,
  IdentityOnboardingDraft,
  IdentityService,
  StoredIdentitySummary,
} from "../../runtime";
import type {
  RuntimeCoreIdentity,
  RuntimeCoreIdentityApi,
  RuntimeCoreStatus,
} from "../types";

export type RuntimeCoreIdentityApiContext = {
  getStatus: () => RuntimeCoreStatus;
  getActiveIdentity: () => RuntimeCoreIdentity | null;
  ensureRuntime: () => Promise<unknown>;
  bootstrap: (mode?: IdentityBootstrapMode) => Promise<void>;
  teardownRuntime: () => Promise<void>;
  ensureIdentityService: () => IdentityService;
};

export function createRuntimeCoreIdentityApi(
  context: RuntimeCoreIdentityApiContext,
): RuntimeCoreIdentityApi {
  return {
    getStatus() {
      return context.getStatus();
    },
    getActiveIdentity() {
      return context.getActiveIdentity();
    },
    async ensureActiveIdentity() {
      await context.ensureRuntime();
      const current = context.getActiveIdentity();
      if (!current) {
        throw new Error("Active identity is unavailable.");
      }
      return current;
    },
    async ensureUnlocked(mode) {
      if (context.getActiveIdentity() && context.getStatus() === "ready") {
        return context.getActiveIdentity()!;
      }
      await context.bootstrap(mode);
      const current = context.getActiveIdentity();
      if (!current) {
        throw new Error("Active identity is unavailable.");
      }
      return current;
    },
    async lock() {
      await context.ensureIdentityService().lock();
      await context.teardownRuntime();
    },
    async createOnboardingDraft(input?: {
      words?: 12 | 24;
      totpIssuer?: string;
      totpAccountName?: string;
    }): Promise<IdentityOnboardingDraft> {
      return await context.ensureIdentityService().createOnboardingDraft(input);
    },
    async completeOnboarding(input): Promise<RuntimeCoreIdentity> {
      await context.ensureIdentityService().completeOnboarding(input);
      await context.teardownRuntime();
      await context.bootstrap("auto");
      const current = context.getActiveIdentity();
      if (!current) {
        throw new Error("Active identity is unavailable after onboarding.");
      }
      return current;
    },
    async recoverFromMnemonic(input): Promise<RuntimeCoreIdentity> {
      await context.ensureIdentityService().recoverFromMnemonic(input);
      await context.teardownRuntime();
      await context.bootstrap("auto");
      const current = context.getActiveIdentity();
      if (!current) {
        throw new Error("Active identity is unavailable after recovery.");
      }
      return current;
    },
    async unlockWithPassword(input: {
      password: string;
      totpCode?: string;
    }): Promise<RuntimeCoreIdentity> {
      await context.ensureIdentityService().unlockWithPassword(input);
      await context.teardownRuntime();
      await context.bootstrap("unlock-only");
      const current = context.getActiveIdentity();
      if (!current) {
        throw new Error("Active identity is unavailable after unlock.");
      }
      return current;
    },
    getStoredIdentitySummary(): StoredIdentitySummary | null {
      return context.ensureIdentityService().getStoredIdentitySummary();
    },
  };
}

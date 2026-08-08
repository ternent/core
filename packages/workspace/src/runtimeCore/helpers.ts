import type { ConcordState } from "@ternent/concord";
import { toDidKeyFromPublicKey } from "../plugins/identityKey";
import type {
  PermissionActorInput,
  PermissionRecord,
  UserRecord,
} from "../plugins";
import type { AppProjectionPlugin, AppRuntime } from "../runtime";
import type { RuntimeCoreIdentity } from "./types";

export function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createInitialState(plugins: AppProjectionPlugin[]): ConcordState {
  return {
    ready: false,
    integrityValid: false,
    stagedCount: 0,
    replay: Object.fromEntries(
      plugins.map((plugin) => [plugin.plugin.id, plugin.plugin.initialState?.()]),
    ),
    verification: null,
  };
}

export function requireSelector(
  plugins: AppProjectionPlugin[],
  pluginId: string,
  selectorId: string,
) {
  const plugin = plugins.find((candidate) => candidate.plugin.id === pluginId);
  if (!plugin) {
    throw new Error(`Unknown plugin id '${pluginId}'.`);
  }

  const selector = plugin.selectors?.[selectorId];
  if (!selector) {
    throw new Error(`Unknown selector '${selectorId}' for plugin '${pluginId}'.`);
  }

  return selector;
}

export function buildPermissionActor(activeIdentity: RuntimeCoreIdentity | null): PermissionActorInput {
  if (!activeIdentity) {
    throw new Error("Active identity is required.");
  }

  return {
    memberId: activeIdentity.identityKey,
    memberLabel: activeIdentity.label,
  };
}

export function requireActiveIdentity(
  activeIdentity: RuntimeCoreIdentity | null,
): RuntimeCoreIdentity {
  if (!activeIdentity) {
    throw new Error("Active identity is required.");
  }

  return activeIdentity;
}

export function requireProjectedUser(
  lookup: (identityKey: string) => UserRecord | null,
  identityKey: string,
): UserRecord {
  const user = lookup(identityKey);
  if (!user) {
    throw new Error(
      `User '${identityKey}' is not available in users projection. Add it from the users area first.`,
    );
  }

  return user;
}

export function toRuntimeCoreIdentity(input: {
  identityId: string;
  label: string;
  publicKey: string;
}): RuntimeCoreIdentity {
  return {
    identityId: input.identityId,
    identityKey: toDidKeyFromPublicKey(input.publicKey),
    label: input.label,
  };
}

function isFreshLedger(resolvedRuntime: AppRuntime): boolean {
  const users = resolvedRuntime.select<UserRecord[]>("users", "all");
  const permissions = resolvedRuntime.select<PermissionRecord[]>(
    "permissions",
    "all",
    null,
    null,
  );
  const snapshot = resolvedRuntime.getState();

  return snapshot.stagedCount === 0 && users.length === 0 && permissions.length === 0;
}

export async function ensureCreatorUserBootstrap(
  resolvedRuntime: AppRuntime,
  currentIdentity: RuntimeCoreIdentity | null,
): Promise<void> {
  if (!currentIdentity || !isFreshLedger(resolvedRuntime)) {
    return;
  }

  await resolvedRuntime.commandWithReplay("user.create", {
    identityKey: currentIdentity.identityKey,
    actorIdentityKey: currentIdentity.identityKey,
  });
  await resolvedRuntime.commitWithReplay({
    metadata: {
      message: "Bootstrap creator user",
    },
  });
}

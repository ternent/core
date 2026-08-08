import type { UserCreateInput, UserRecord } from "../../plugins";
import type { RuntimeCoreIdentity, RuntimeCoreUsersApi } from "../types";
import type { RuntimeCoreSharedContext } from "./shared";

export type RuntimeCoreUsersApiContext = RuntimeCoreSharedContext<RuntimeCoreIdentity> & {
  requireActiveIdentity: (activeIdentity: RuntimeCoreIdentity | null) => RuntimeCoreIdentity;
};

export function createRuntimeCoreUsersApi(
  context: RuntimeCoreUsersApiContext,
): RuntimeCoreUsersApi {
  return {
    create(input: Omit<UserCreateInput, "actorIdentityKey">) {
      const actor = context.requireActiveIdentity(context.activeIdentity());
      return context.command("user.create", {
        ...input,
        actorIdentityKey: actor.identityKey,
      } as UserCreateInput);
    },
    all() {
      return context.select<UserRecord[]>("users", "all");
    },
    byIdentityKey(identityKey: string) {
      return context.select<UserRecord | null>("users", "byIdentityKey", identityKey);
    },
  };
}

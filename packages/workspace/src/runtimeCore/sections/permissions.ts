import type {
  PermissionActorInput,
  PermissionCreateInput,
  PermissionGrantInput,
  PermissionRecord,
  PermissionRevokeInput,
  UserRecord,
} from "../../plugins";
import type {
  RuntimeCoreIdentity,
  RuntimeCorePermissionsApi,
} from "../types";
import type { RuntimeCoreSharedContext } from "./shared";
import { resolveViewerIdentity } from "./shared";

export type RuntimeCorePermissionsApiContext =
  RuntimeCoreSharedContext<RuntimeCoreIdentity> & {
    requireActiveIdentity: (
      activeIdentity: RuntimeCoreIdentity | null,
    ) => RuntimeCoreIdentity;
    buildPermissionActor: (
      activeIdentity: RuntimeCoreIdentity | null,
    ) => PermissionActorInput;
    requireProjectedUser: (
      lookup: (identityKey: string) => UserRecord | null,
      identityKey: string,
    ) => UserRecord;
  };

type ProfileRecordLike = {
  displayName: string | null;
};

function trySelectProfile(
  context: RuntimeCorePermissionsApiContext,
  identityKey: string,
): ProfileRecordLike | null {
  try {
    return context.select<ProfileRecordLike | null>("profiles", "byIdentityKey", identityKey);
  } catch {
    return null;
  }
}

export function createRuntimeCorePermissionsApi(
  context: RuntimeCorePermissionsApiContext,
): RuntimeCorePermissionsApi {
  return {
    create(input: Omit<PermissionCreateInput, "actor">) {
      const actor = context.buildPermissionActor(context.activeIdentity());
      return context.command("permission.create", {
        ...input,
        actor,
      } as PermissionCreateInput);
    },
    createGroup(input: Omit<PermissionCreateInput, "actor">) {
      const actor = context.buildPermissionActor(context.activeIdentity());
      return context.command("permission.group.create", {
        ...input,
        actor,
      } as PermissionCreateInput);
    },
    grant(input: Omit<PermissionGrantInput, "actor">) {
      const actor = context.buildPermissionActor(context.activeIdentity());
      const projectedUser = context.requireProjectedUser(
        (identityKey) => context.select<UserRecord | null>("users", "byIdentityKey", identityKey),
        input.memberId,
      );
      return context.command("permission.grant", {
        ...input,
        memberLabel: projectedUser.label ?? null,
        actor,
      } as PermissionGrantInput);
    },
    issueGrant(input: Omit<PermissionGrantInput, "actor">) {
      const actor = context.buildPermissionActor(context.activeIdentity());
      const projectedUser = context.requireProjectedUser(
        (identityKey) => context.select<UserRecord | null>("users", "byIdentityKey", identityKey),
        input.memberId,
      );
      return context.command("permission.grant.issue", {
        ...input,
        memberLabel: projectedUser.label ?? null,
        actor,
      } as PermissionGrantInput);
    },
    grantFromUser(input: { permissionId: string; identityKey: string }) {
      const active = context.requireActiveIdentity(context.activeIdentity());
      const actor = context.buildPermissionActor(context.activeIdentity());
      const projectedUser = context.requireProjectedUser(
        (identityKey) => context.select<UserRecord | null>("users", "byIdentityKey", identityKey),
        input.identityKey,
      );
      const { viewerIdentityKey, viewerIdentityId } = resolveViewerIdentity(
        context.activeIdentity(),
      );
      const permission = context.select<PermissionRecord | null>(
        "permissions",
        "byId",
        input.permissionId,
        viewerIdentityKey,
        viewerIdentityId,
      );
      if (permission) {
        const alreadyAssigned = permission.members.some((member) => {
          if (member.memberId === projectedUser.identityKey) {
            return true;
          }
          if (projectedUser.identityKey === active.identityKey && member.memberId === active.identityId) {
            return true;
          }
          return false;
        });
        if (alreadyAssigned) {
          throw new Error("User already assigned to this permission.");
        }
      }

      const profile = trySelectProfile(context, projectedUser.identityKey);
      const resolvedMemberLabel = profile?.displayName ?? projectedUser.label ?? null;

      return context.command("permission.grant.issue", {
        permissionId: input.permissionId,
        memberId: projectedUser.identityKey,
        memberLabel: resolvedMemberLabel,
        actor,
      } as PermissionGrantInput);
    },
    revoke(input: Omit<PermissionRevokeInput, "actor">) {
      const actor = context.buildPermissionActor(context.activeIdentity());
      return context.command("permission.revoke", {
        ...input,
        actor,
      } as PermissionRevokeInput);
    },
    all() {
      const { viewerIdentityKey, viewerIdentityId } = resolveViewerIdentity(
        context.activeIdentity(),
      );
      return context.select<PermissionRecord[]>(
        "permissions",
        "all",
        viewerIdentityKey,
        viewerIdentityId,
      );
    },
    byId(permissionId: string) {
      const { viewerIdentityKey, viewerIdentityId } = resolveViewerIdentity(
        context.activeIdentity(),
      );
      return context.select<PermissionRecord | null>(
        "permissions",
        "byId",
        permissionId,
        viewerIdentityKey,
        viewerIdentityId,
      );
    },
  };
}

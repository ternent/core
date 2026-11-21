import { caught, error, type Result } from "../common/errors.js";
import { nonce } from "../common/random.js";
import type { Capability, CommitReceipt, DocumentHandle } from "../model/types.js";
import type { AudienceId, GroupId, Json, PublicIdentity } from "../protocol/types.js";
import type { SystemIntent } from "./types.js";

type Author = (kind: SystemIntent["kind"], input: unknown) => Promise<Result<CommitReceipt>>;
export const systemAuthors = new WeakMap<object, Author>();

function author(handle: object, kind: SystemIntent["kind"], input: unknown) {
  const write = systemAuthors.get(handle);
  return write
    ? write(kind, input)
    : Promise.resolve({ ok: false as const, error: error("HOST_CONFIGURATION", "requirements") });
}

export function setMember<S extends Json, C extends Record<string, Json>>(
  handle: DocumentHandle<S, C>,
  input: { audience?: AudienceId; identity: PublicIdentity; capabilities: readonly Capability[] },
): Promise<Result<CommitReceipt>> {
  return author(handle, "member.set", input);
}

export function removeMember<S extends Json, C extends Record<string, Json>>(
  handle: DocumentHandle<S, C>,
  input: { audience?: AudienceId; identityId: string },
): Promise<Result<CommitReceipt>> {
  return author(handle, "member.remove", input);
}

export async function createGroup<S extends Json, C extends Record<string, Json>>(
  handle: DocumentHandle<S, C>,
): Promise<Result<CommitReceipt & { audience: GroupId }>> {
  try {
    const audience: GroupId = `group:${nonce()}`;
    const result = await author(handle, "group.create", { audience });
    return result.ok ? { ok: true, value: { ...result.value, audience } } : result;
  } catch (cause) {
    return { ok: false, error: caught(cause, "SYSTEM_FAILED", "author") };
  }
}

import { validatePublicIdentity } from "@ternent/identity";
import { fail } from "../common/errors.js";
import type { Capability, Member } from "../model/types.js";
import type { PublicIdentity } from "../protocol/types.js";
import { equal } from "./audience.js";

export const allCapabilities: readonly Capability[] = ["read", "write", "grant", "administer"];

export function identity(value: unknown): PublicIdentity {
  const result = validatePublicIdentity(value);
  if (!result.ok) fail("SYSTEM_EVENT_INVALID", "system");
  return result.value;
}

export function identityId(value: unknown): string {
  if (typeof value !== "string" || !/^identity:[0-9a-f]{64}$/.test(value))
    fail("SYSTEM_EVENT_INVALID", "system");
  return value;
}

export function capabilitySet(value: unknown, wire: boolean): Capability[] {
  if (!Array.isArray(value)) fail("SYSTEM_EVENT_INVALID", "system");
  const capabilities = allCapabilities.filter((capability) => value.includes(capability));
  if (
    capabilities.length !== value.length ||
    !capabilities.includes("read") ||
    (wire && !capabilities.every((capability, index) => value[index] === capability))
  )
    fail("SYSTEM_EVENT_INVALID", "system");
  return capabilities;
}

export function orderedMembers(members: ReadonlyMap<string, Member>): Member[] {
  return [...members.keys()].sort().map((id) => members.get(id)!);
}

export function capabilitiesOf(members: ReadonlyMap<string, Member>, actor: PublicIdentity) {
  const member = members.get(actor.id);
  return member && equal(member.identity, actor) ? member.capabilities : [];
}

function anotherAdministrator(members: ReadonlyMap<string, Member>, target: string): boolean {
  return [...members.values()].some(
    (member) => member.identity.id !== target && member.capabilities.includes("administer"),
  );
}

export function checkSet(
  members: ReadonlyMap<string, Member>,
  actor: PublicIdentity,
  target: PublicIdentity,
  capabilities: readonly Capability[],
): boolean {
  const authority = capabilitiesOf(members, actor);
  const existing = members.get(target.id);
  if (
    !authority.includes("administer") &&
    (!authority.includes("grant") ||
      capabilities.some(
        (capability) =>
          (capability !== "read" && capability !== "write") || !authority.includes(capability),
      ) ||
      existing?.capabilities.some(
        (capability) => capability === "grant" || capability === "administer",
      ))
  )
    fail("CAPABILITY_DENIED", "system");

  if (!existing) return true;
  if (!equal(existing.identity, target)) fail("SYSTEM_EVENT_INVALID", "system");
  if (equal(existing.capabilities, capabilities)) fail("SYSTEM_NO_CHANGE", "system");
  if (
    existing.capabilities.includes("administer") &&
    !capabilities.includes("administer") &&
    !anotherAdministrator(members, target.id)
  )
    fail("LAST_ADMINISTRATOR", "system");
  return false;
}

export function checkRemoval(
  members: ReadonlyMap<string, Member>,
  actor: PublicIdentity,
  target: string,
): void {
  if (!capabilitiesOf(members, actor).includes("administer")) fail("CAPABILITY_DENIED", "system");
  if (!members.has(target)) fail("SYSTEM_EVENT_INVALID", "system");
  if (!anotherAdministrator(members, target)) fail("LAST_ADMINISTRATOR", "system");
  if (actor.id === target) fail("SYSTEM_EVENT_INVALID", "system");
}

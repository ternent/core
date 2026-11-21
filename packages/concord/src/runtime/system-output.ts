import { validateAgeRecipient, validatePublicIdentity } from "@ternent/identity";
import { fail } from "../common/errors.js";
import { freeze } from "../common/immutable.js";
import { isAudienceId } from "../protocol/schema.js";
import type { Snapshot, Limits, PublicIdentity } from "../protocol/types.js";
import type { Capability, Member } from "../model/types.js";
import type { SystemReplay } from "../system/types.js";
import { capabilities, json, same } from "./validation.js";

export function checkSystem(output: SystemReplay, wire: Snapshot, lim: Limits): SystemReplay {
  const application = wire.entries.filter((e) => e.subject.kind === "application");
  if (
    !output ||
    !output.session ||
    typeof output.session !== "object" ||
    !Array.isArray(output.entryFacts) ||
    !Array.isArray(output.entries) ||
    !Array.isArray(output.audiences) ||
    output.entryFacts.length !== wire.entries.length ||
    output.entries.length !== application.length
  )
    fail("SYSTEM_FAILED", "system");
  // Repeated facts expand with history; bound each value, not their aggregate encoding.
  const copy = <T>(value: T): T => json(value, lim, "SYSTEM_FAILED", "system");
  const entryFacts = output.entryFacts.map(copy);
  const entries = output.entries.map(copy);
  const audiences = output.audiences.map(copy);
  const reader = copy(output.reader);
  const exact = (value: unknown, keys: readonly string[]) =>
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
  const identities = new Map<string, PublicIdentity>();
  const validIdentity = (value: PublicIdentity): boolean => {
    if (!exact(value, ["version", "algorithm", "publicKey", "id"])) return false;
    const known = identities.get(value.id);
    if (known) return same(known, value);
    if (!validatePublicIdentity(value).ok) return false;
    identities.set(value.id, value);
    return true;
  };
  const validCapabilities = (values: readonly Capability[], read: boolean): boolean =>
    Array.isArray(values) &&
    (!read || values.includes("read")) &&
    values.every(
      (value: Capability, i: number) =>
        capabilities.includes(value) &&
        (i === 0 || capabilities.indexOf(values[i - 1]) < capabilities.indexOf(value)),
    );
  const validMembers = (values: readonly Member[]): boolean =>
    Array.isArray(values) &&
    values.every(
      (member: Member, i: number) =>
        exact(member, ["identity", "capabilities"]) &&
        validIdentity(member.identity) &&
        validCapabilities(member.capabilities, true) &&
        (i === 0 || values[i - 1].identity.id < member.identity.id),
    );
  const recipients = new Set<string>();
  const validRecipient = (value: string): boolean => {
    if (typeof value !== "string") return false;
    if (recipients.has(value)) return true;
    if (!validateAgeRecipient(value).ok) return false;
    recipients.add(value);
    return true;
  };
  if (reader !== null && !validIdentity(reader)) fail("SYSTEM_FAILED", "system");
  if (
    !audiences.some((group) => group.audience === "document") ||
    audiences.some(
      (group, i) =>
        !exact(group, ["audience", "members", "epochs"]) ||
        !isAudienceId(group.audience) ||
        !validMembers(group.members) ||
        !Array.isArray(group.epochs) ||
        group.epochs.length === 0 ||
        !group.epochs.every(
          (record: { epoch: number; recipient: string }, index: number) =>
            exact(record, ["epoch", "recipient"]) &&
            record.epoch === index &&
            validRecipient(record.recipient),
        ) ||
        (i > 0 && audiences[i - 1].audience >= group.audience),
    )
  )
    fail("SYSTEM_FAILED", "system");
  const audienceIds = new Set(audiences.map((group) => group.audience));
  let index = 0;
  for (const commit of wire.commits)
    for (const entryId of commit.subject.entryIds) {
      const item = entryFacts[index++];
      if (
        !item ||
        !exact(item, ["entryId", "facts"]) ||
        !exact(item.facts, ["actor", "audience", "capabilities", "members"]) ||
        item.entryId !== entryId ||
        !same(item.facts.actor, commit.subject.signer) ||
        !audienceIds.has(item.facts.audience) ||
        !validMembers(item.facts.members) ||
        !validCapabilities(item.facts.capabilities, false)
      )
        fail("SYSTEM_FAILED", "system");
    }
  const facts = new Map(entryFacts.map((item) => [item.entryId, item.facts]));
  for (let i = 0; i < application.length; i++) {
    const item = entries[i];
    const subject = application[i].subject;
    if (subject.kind !== "application") fail("SYSTEM_FAILED", "system");
    const envelope = subject.payload;
    if (
      !item ||
      !exact(
        item,
        item.status === "readable"
          ? ["status", "entryId", "event", "facts"]
          : ["status", "entryId", "audience", "epoch", "facts"],
      ) ||
      item.entryId !== application[i].id ||
      !same(item.facts, facts.get(application[i].id)) ||
      item.facts.audience !== envelope.audience ||
      (item.status !== "readable" && item.status !== "locked") ||
      (item.status === "locked" &&
        (item.audience !== envelope.audience ||
          item.epoch !== envelope.epoch ||
          Object.hasOwn(item, "event")))
    )
      fail("SYSTEM_FAILED", "system");
  }
  return freeze({ entryFacts, entries, audiences, reader, session: output.session });
}

import { ageRecipientFromSecret, validateAgeRecipient } from "@ternent/identity";
import { decryptAgeWithSecret } from "@ternent/armour";
import { caught, fail, ok } from "../common/errors.js";
import { detached, freeze } from "../common/immutable.js";
import { nonce } from "../common/random.js";
import { isVerifiedHistory } from "../protocol/history.js";
import type {
  CommitId,
  DomainEvent,
  EntryId,
  EntrySubject,
  JsonObject,
  Limits,
} from "../protocol/types.js";
import type { Member, SystemFacts } from "../model/types.js";
import type { SystemProfile, SystemReplay } from "./types.js";
import {
  encrypt,
  equal,
  fields,
  groupSecret,
  plaintext,
  unbase,
  unwrapKey,
  wrapKey,
} from "./audience.js";
import {
  allCapabilities,
  capabilitiesOf,
  capabilitySet,
  checkRemoval,
  checkSet,
  identity,
  identityId,
  orderedMembers,
} from "./membership.js";

type Location = { entryId: EntryId; commitId: CommitId; path: string };
type SystemEntry = Extract<EntrySubject, { kind: "system" }>;
type ApplicationEntry = Extract<EntrySubject, { kind: "application" }>;
type Wrap = {
  identityId: string;
  epoch: number;
  ciphertext: string;
  subject: SystemEntry;
  location: Location;
};
type Session = {
  head: CommitId;
  readerId: string;
  members: readonly Member[];
  recipients: readonly string[];
  secrets: Map<number, Uint8Array>;
};

function recipient(value: unknown): string {
  if (typeof value !== "string" || !validateAgeRecipient(value).ok)
    fail("SYSTEM_EVENT_INVALID", "system");
  return value;
}

function epochNumber(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    fail("SYSTEM_EVENT_INVALID", "system");
  return value;
}

function ciphertext(value: unknown, lim: Limits): string {
  if (typeof value !== "string") fail("SYSTEM_EVENT_INVALID", "system");
  unbase(value, lim, "KEY_WRAP_INVALID");
  return value;
}

function recipientWraps(
  value: unknown,
  epoch: number,
  subject: SystemEntry,
  location: Location,
  lim: Limits,
): Wrap[] {
  if (!Array.isArray(value)) fail("SYSTEM_EVENT_INVALID", "system");
  const wraps = value.map((record: unknown, index) => {
    fields(record, ["identityId", "ciphertext"], "SYSTEM_EVENT_INVALID");
    return {
      identityId: identityId(record.identityId),
      ciphertext: ciphertext(record.ciphertext, lim),
      epoch,
      subject,
      location: { ...location, path: `${location.path}/data/wraps/${index}` },
    };
  });
  if (wraps.some((wrap, i) => i > 0 && wraps[i - 1].identityId >= wrap.identityId))
    fail("SYSTEM_EVENT_INVALID", "system");
  return wraps;
}

function historicalWraps(
  value: unknown,
  target: string,
  subject: SystemEntry,
  location: Location,
  lim: Limits,
): Wrap[] {
  if (!Array.isArray(value)) fail("SYSTEM_EVENT_INVALID", "system");
  const wraps = value.map((record: unknown, index) => {
    fields(record, ["epoch", "ciphertext"], "SYSTEM_EVENT_INVALID");
    return {
      identityId: target,
      epoch: epochNumber(record.epoch),
      ciphertext: ciphertext(record.ciphertext, lim),
      subject,
      location: { ...location, path: `${location.path}/data/history/${index}` },
    };
  });
  if (wraps.some((wrap, i) => i > 0 && wraps[i - 1].epoch >= wrap.epoch))
    fail("SYSTEM_EVENT_INVALID", "system");
  return wraps;
}

async function decryptApplication(
  subject: ApplicationEntry,
  secret: Uint8Array,
  model: JsonObject,
  lim: Limits,
): Promise<DomainEvent> {
  const decrypted = await decryptAgeWithSecret({
    secret,
    ciphertext: unbase(subject.payload.ciphertext, lim, "EVENT_CONTEXT_INVALID"),
  });
  if (!decrypted.ok) fail("DECRYPTION_INVALID", "system");
  const body = plaintext(decrypted.value, lim, "EVENT_CONTEXT_INVALID");
  fields(
    body,
    ["context", "parent", "nonce", "model", "audience", "epoch", "event"],
    "EVENT_CONTEXT_INVALID",
  );
  if (
    body.context !== "concord.application/1" ||
    body.parent !== subject.parent ||
    body.nonce !== subject.nonce ||
    !equal(body.model, model) ||
    body.audience !== "document" ||
    body.epoch !== subject.payload.epoch
  )
    fail("EVENT_CONTEXT_INVALID", "system");
  fields(body.event, ["type", "version", "data"], "EVENT_CONTEXT_INVALID");
  if (
    typeof body.event.type !== "string" ||
    !/^[a-z][a-z0-9.-]{0,127}$/.test(body.event.type) ||
    !Number.isInteger(body.event.version) ||
    Number(body.event.version) < 1 ||
    Number(body.event.version) > 2147483647
  )
    fail("EVENT_CONTEXT_INVALID", "system");
  return body.event as DomainEvent;
}

export function createStandardSystemProfile(): SystemProfile {
  const sessions = new WeakMap<object, Session>();
  return Object.freeze<SystemProfile>({
    ref: freeze({ id: "concord.standard", version: 1 }),
    async bootstrap({ signer, limits: lim }) {
      const secret = groupSecret();
      try {
        const recipient = ageRecipientFromSecret(secret);
        const context = { parent: null, nonce: nonce() };
        const owner = signer.publicIdentity;
        return ok({
          ...context,
          version: 1,
          kind: "system",
          payload: {
            type: "system.init",
            version: 1,
            data: {
              audience: "document",
              epoch: 0,
              recipient,
              owner: { ...owner },
              wraps: [
                {
                  identityId: owner.id,
                  ciphertext: await wrapKey(context, owner, 0, recipient, secret, lim),
                },
              ],
            },
          },
        });
      } catch (cause) {
        return { ok: false, error: caught(cause, "SYSTEM_FAILED", "system") };
      } finally {
        secret.fill(0);
      }
    },

    async replay({ history, reader, limits: lim }) {
      const secrets = new Map<number, Uint8Array>();
      let stored = false;
      let location: Location | undefined;
      try {
        if (!isVerifiedHistory(history)) fail("HOST_CONFIGURATION", "requirements");
        const members = new Map<string, Member>();
        const recipients: string[] = [];
        const wraps: Wrap[] = [];
        const entryFacts: SystemReplay["entryFacts"][number][] = [];
        const applications: {
          subject: ApplicationEntry;
          facts: SystemFacts;
          location: Location;
        }[] = [];

        // Establish authority for the entire signed history before touching any key.
        for (const [index, { entry, commit }] of history.ordered.entries()) {
          const subject = entry.subject;
          const actor = commit.subject.signer;
          location = {
            entryId: entry.id,
            commitId: commit.id,
            path: `/entries/${index}/subject/payload`,
          };
          let facts = detached({
            actor,
            capabilities: capabilitiesOf(members, actor),
            members: orderedMembers(members),
          });

          if (subject.kind === "application") {
            if (!recipients.length || subject.parent === null)
              fail("SYSTEM_EVENT_INVALID", "system");
            if (!facts.capabilities.includes("write")) fail("CAPABILITY_DENIED", "system");
            if (subject.payload.epoch !== recipients.length - 1)
              fail("SYSTEM_EVENT_INVALID", "system");
            applications.push({ subject, facts, location });
          } else {
            const { type, version, data } = subject.payload;
            if (
              version !== 1 ||
              (type !== "system.init" &&
                type !== "system.member.set" &&
                type !== "system.member.remove")
            )
              fail("UNSUPPORTED_SYSTEM_EVENT", "system");
            if (type === "system.init") {
              if (index !== 0 || subject.parent !== null || commit.subject.entryIds.length !== 1)
                fail("SYSTEM_EVENT_INVALID", "system");
              fields(
                data,
                ["audience", "epoch", "recipient", "owner", "wraps"],
                "SYSTEM_EVENT_INVALID",
              );
              const owner = identity(data.owner);
              const first = recipient(data.recipient);
              const initial = recipientWraps(data.wraps, 0, subject, location, lim);
              if (
                !equal(owner, actor) ||
                data.audience !== "document" ||
                data.epoch !== 0 ||
                initial.length !== 1 ||
                initial[0].identityId !== owner.id
              )
                fail("SYSTEM_EVENT_INVALID", "system");
              members.set(owner.id, { identity: owner, capabilities: allCapabilities });
              recipients.push(first);
              wraps.push(initial[0]);
              facts = detached({
                actor,
                capabilities: allCapabilities,
                members: orderedMembers(members),
              });
            } else if (type === "system.member.set") {
              fields(data, ["identity", "capabilities", "history"], "SYSTEM_EVENT_INVALID");
              const target = identity(data.identity);
              const capabilities = capabilitySet(data.capabilities, true);
              const historical = historicalWraps(data.history, target.id, subject, location, lim);
              if (!recipients.length) fail("SYSTEM_EVENT_INVALID", "system");
              const admission = checkSet(members, actor, target, capabilities);
              if (
                historical.length !== (admission ? recipients.length : 0) ||
                historical.some((wrap, i) => wrap.epoch !== i)
              )
                fail("SYSTEM_EVENT_INVALID", "system");
              members.set(target.id, { identity: target, capabilities });
              for (const wrap of historical) wraps.push(wrap);
            } else {
              fields(data, ["identityId", "epoch", "recipient", "wraps"], "SYSTEM_EVENT_INVALID");
              const target = identityId(data.identityId);
              const epoch = epochNumber(data.epoch);
              const next = recipient(data.recipient);
              const rotations = recipientWraps(data.wraps, epoch, subject, location, lim);
              if (!recipients.length) fail("SYSTEM_EVENT_INVALID", "system");
              checkRemoval(members, actor, target);
              const remaining = [...members.keys()].filter((id) => id !== target).sort();
              if (
                epoch !== recipients.length ||
                recipients.includes(next) ||
                rotations.length !== remaining.length ||
                rotations.some((wrap, i) => wrap.identityId !== remaining[i])
              )
                fail("SYSTEM_EVENT_INVALID", "system");
              members.delete(target);
              recipients.push(next);
              for (const wrap of rotations) wraps.push(wrap);
            }
          }
          entryFacts.push({ entryId: entry.id, facts });
        }

        if (!reader || !capabilitiesOf(members, reader.publicIdentity).includes("read")) {
          const finding = caught(undefined, "READ_ACCESS_REQUIRED", "system");
          finding.details = { lockedEntries: applications.length };
          return { ok: false, error: finding };
        }
        for (const wrap of wraps) {
          if (wrap.identityId !== reader.publicIdentity.id) continue;
          location = wrap.location;
          const secret = await unwrapKey(
            wrap.subject,
            reader,
            wrap.epoch,
            recipients[wrap.epoch],
            wrap.ciphertext,
            lim,
          );
          // Re-admission carries a full new set of wraps. Validate earlier wraps, then use the latest.
          secrets.get(wrap.epoch)?.fill(0);
          secrets.set(wrap.epoch, secret);
        }
        if (secrets.size !== recipients.length) {
          const finding = caught(undefined, "KEY_UNAVAILABLE", "system");
          finding.details = {
            lockedEntries: applications.filter(({ subject }) => !secrets.has(subject.payload.epoch))
              .length,
          };
          return { ok: false, error: finding };
        }
        const events: SystemReplay["events"][number][] = [];
        for (const application of applications) {
          location = application.location;
          events.push({
            entryId: location.entryId,
            event: await decryptApplication(
              application.subject,
              secrets.get(application.subject.payload.epoch)!,
              history.declaration.model,
              lim,
            ),
            facts: application.facts,
          });
        }
        const session = Object.freeze({});
        const active = orderedMembers(members);
        const output = freeze({
          entryFacts,
          events,
          members: active,
          epochs: recipients.map((recipient, epoch) => ({ epoch, recipient })),
          reader: reader.publicIdentity,
          session,
        });
        sessions.set(session, {
          head: history.head,
          readerId: reader.publicIdentity.id,
          members: active,
          recipients,
          secrets,
        });
        stored = true;
        return ok(output);
      } catch (cause) {
        const finding = caught(cause, "SYSTEM_FAILED", "system");
        if (location) Object.assign(finding, location);
        return { ok: false, error: finding };
      } finally {
        if (!stored) for (const secret of secrets.values()) secret.fill(0);
      }
    },

    async prepare({ history, current, signer, intents, limits: lim }) {
      const generated: Uint8Array[] = [];
      try {
        const session = sessions.get(current.session);
        if (!isVerifiedHistory(history) || !session || session.head !== history.head)
          fail("HOST_CONFIGURATION", "requirements");
        const actor = signer.publicIdentity;
        if (actor.id !== session.readerId || !equal(actor, current.reader))
          fail("CAPABILITY_DENIED", "system");
        const members = new Map(session.members.map((member) => [member.identity.id, member]));
        const recipients = [...session.recipients];
        const secrets = new Map(session.secrets);
        const entries: EntrySubject[] = [];
        for (const intent of intents) {
          const entry = { version: 1 as const, parent: history.head, nonce: nonce() };
          if (intent.kind === "application") {
            const authority = capabilitiesOf(members, actor);
            if (
              !authority.includes("write") ||
              !intent.required.every((capability) => authority.includes(capability))
            )
              fail("CAPABILITY_DENIED", "system");
            const epoch = recipients.length - 1;
            const ciphertext = await encrypt(
              recipients[epoch],
              {
                context: "concord.application/1",
                parent: entry.parent,
                nonce: entry.nonce,
                model: history.declaration.model,
                audience: "document",
                epoch,
                event: intent.event,
              },
              lim,
            );
            entries.push({
              ...entry,
              kind: "application",
              payload: { audience: "document", epoch, ciphertext },
            });
          } else if (intent.kind === "member.set") {
            fields(intent, ["kind", "identity", "capabilities"], "SYSTEM_EVENT_INVALID");
            const target = identity(intent.identity);
            const capabilities = capabilitySet(intent.capabilities, false);
            const admission = checkSet(members, actor, target, capabilities);
            const history: { epoch: number; ciphertext: string }[] = [];
            if (admission) {
              for (const [epoch, recipient] of recipients.entries()) {
                const secret = secrets.get(epoch);
                if (!secret) fail("HISTORICAL_KEY_UNAVAILABLE", "author");
                history.push({
                  epoch,
                  ciphertext: await wrapKey(entry, target, epoch, recipient, secret, lim),
                });
              }
            }
            members.set(target.id, { identity: target, capabilities });
            entries.push({
              ...entry,
              kind: "system",
              payload: {
                type: "system.member.set",
                version: 1,
                data: { identity: target, capabilities, history },
              },
            });
          } else {
            fields(intent, ["kind", "identityId"], "SYSTEM_EVENT_INVALID");
            const target = identityId(intent.identityId);
            checkRemoval(members, actor, target);
            const secret = groupSecret();
            generated.push(secret);
            const recipient = ageRecipientFromSecret(secret);
            if (recipients.includes(recipient)) fail("SYSTEM_FAILED", "system");
            const epoch = recipients.length;
            members.delete(target);
            const wraps: { identityId: string; ciphertext: string }[] = [];
            for (const { identity } of orderedMembers(members)) {
              wraps.push({
                identityId: identity.id,
                ciphertext: await wrapKey(entry, identity, epoch, recipient, secret, lim),
              });
            }
            recipients.push(recipient);
            secrets.set(epoch, secret);
            entries.push({
              ...entry,
              kind: "system",
              payload: {
                type: "system.member.remove",
                version: 1,
                data: { identityId: target, epoch, recipient, wraps },
              },
            });
          }
        }
        return ok(entries);
      } catch (cause) {
        return { ok: false, error: caught(cause, "SYSTEM_FAILED", "system") };
      } finally {
        for (const secret of generated) secret.fill(0);
      }
    },
  });
}

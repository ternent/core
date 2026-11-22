import { decodeBase64Url } from "@ternent/identity";
import { fail } from "../common/errors.js";
import type {
  AudienceId,
  Limits,
  Snapshot,
  Declaration,
  RawEntryRecord,
  EntryRecord,
  EntrySubject,
} from "./types.js";
export function isAudienceId(value: unknown): value is AudienceId {
  if (value === "document") return true;
  if (typeof value !== "string" || !/^group:[A-Za-z0-9_-]{22}$/.test(value)) return false;
  const decoded = decodeBase64Url(value.slice(6));
  return decoded.ok && decoded.value.length === 16;
}
export const defaults: Limits = {
  maxBytes: 16 * 1024 * 1024,
  maxCommits: 10_000,
  maxEntries: 100_000,
  maxCiphertextBytes: 1024 * 1024,
  maxDepth: 64,
  maxMetadataBytes: 64 * 1024,
};
export function limits(input: Partial<Limits> = {}): Limits {
  if (
    !input ||
    typeof input !== "object" ||
    Object.keys(input).some((k) => !Object.hasOwn(defaults, k))
  )
    fail("HOST_CONFIGURATION", "requirements");
  const result = { ...defaults, ...input };
  if (Object.values(result).some((v) => !Number.isSafeInteger(v) || v <= 0))
    fail("HOST_CONFIGURATION", "requirements");
  return result;
}
export function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function closed(
  value: unknown,
  keys: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    fail("SCHEMA_INVALID", "protocol", path);
}
export function ref(value: unknown, path: string): void {
  closed(value, ["id", "version"], path);
  if (
    typeof value.id !== "string" ||
    !/^[a-z][a-z0-9.-]{0,127}$/.test(value.id) ||
    !Number.isInteger(value.version) ||
    Number(value.version) < 1 ||
    Number(value.version) > 2147483647
  )
    fail("SCHEMA_INVALID", "protocol", path);
}
function id(value: unknown, kind: "entry" | "commit", path: string): void {
  if (typeof value !== "string" || !new RegExp(`^${kind}:[0-9a-f]{64}$`).test(value))
    fail("SCHEMA_INVALID", "protocol", path);
}
export function bytes(
  value: unknown,
  size: number | null,
  path: string,
  maximum?: number,
): Uint8Array {
  if (typeof value !== "string") fail("SCHEMA_INVALID", "protocol", path);
  if (maximum !== undefined && Math.floor((value.length * 6) / 8) > maximum)
    fail("RESOURCE_LIMIT", "protocol", path);
  const decoded = decodeBase64Url(value);
  if (
    !decoded.ok ||
    (size !== null && decoded.value.length !== size) ||
    (size === null && !decoded.value.length)
  )
    fail("SCHEMA_INVALID", "protocol", path);
  return decoded.value;
}
export function entrySubject(
  input: unknown,
  path: string,
  lim: Limits,
): asserts input is EntrySubject {
  closed(input, ["version", "parent", "nonce", "kind", "payload"], path);
  if (input.version !== 1) fail("SCHEMA_INVALID", "protocol", `${path}/version`);
  if (input.parent !== null) id(input.parent, "commit", `${path}/parent`);
  bytes(input.nonce, 16, `${path}/nonce`);
  if (typeof input.kind !== "string" || !object(input.payload))
    fail("SCHEMA_INVALID", "protocol", path);
  if (input.kind === "system") {
    closed(input.payload, ["type", "version", "data"], `${path}/payload`);
    ref({ id: input.payload.type, version: input.payload.version }, `${path}/payload`);
    if (!object(input.payload.data)) fail("SCHEMA_INVALID", "protocol", `${path}/payload/data`);
    // Ciphertext resource limits apply to every key wrap before profile execution.
    const scan = (value: unknown): void => {
      if (Array.isArray(value)) {
        for (const item of value) scan(item);
      } else if (object(value))
        for (const [key, item] of Object.entries(value)) {
          if (
            key === "ciphertext" &&
            typeof item === "string" &&
            Math.floor((item.length * 6) / 8) > lim.maxCiphertextBytes
          )
            fail("RESOURCE_LIMIT", "protocol", `${path}/payload/data`);
          scan(item);
        }
    };
    scan(input.payload.data);
  } else if (input.kind === "application") {
    closed(input.payload, ["audience", "epoch", "ciphertext"], `${path}/payload`);
    if (
      !isAudienceId(input.payload.audience) ||
      !Number.isSafeInteger(input.payload.epoch) ||
      Number(input.payload.epoch) < 0
    )
      fail("SCHEMA_INVALID", "protocol", `${path}/payload`);
    bytes(input.payload.ciphertext, null, `${path}/payload/ciphertext`, lim.maxCiphertextBytes);
  } else fail("ENTRY_KIND_UNSUPPORTED", "protocol", `${path}/kind`);
}
export function declaration(input: Snapshot): Declaration {
  const metadata = input.commits[0].subject.metadata;
  if (!object(metadata) || !Object.hasOwn(metadata, "concord"))
    fail("DECLARATION_INVALID", "protocol", "/commits/0/subject/metadata");
  closed(metadata, ["concord"], "/commits/0/subject/metadata");
  closed(metadata.concord, ["system", "model"], "/commits/0/subject/metadata/concord");
  ref(metadata.concord.system, "/commits/0/subject/metadata/concord/system");
  ref(metadata.concord.model, "/commits/0/subject/metadata/concord/model");
  return metadata.concord as Declaration;
}

/** Logical framework view of a raw signed entry, retaining its Ledger record ID. */
export function logicalEntry(entry: RawEntryRecord): EntryRecord {
  const subject = entry.subject;
  return {
    id: entry.id,
    subject: {
      version: 1,
      parent: subject.parent,
      nonce: subject.nonce,
      kind: subject.kind,
      payload: subject.payload.data,
    } as EntrySubject,
  };
}

/** Ledger has already validated the raw container and every cryptographic link. */
export function snapshot(input: Snapshot, lim: Limits): void {
  declaration(input);
  for (const [index, entry] of input.entries.entries())
    entrySubject(logicalEntry(entry).subject, `/entries/${index}/subject/payload/data`, lim);
}

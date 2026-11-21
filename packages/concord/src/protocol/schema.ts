import { decodeBase64Url } from "@ternent/identity";
import { fail } from "../common/errors.js";
import { encodeJson } from "./json.js";
import type { AudienceId, Limits, Snapshot, CommitSubject, EntrySubject } from "./types.js";
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
export function publicIdentity(value: unknown, path: string): void {
  closed(value, ["version", "algorithm", "publicKey", "id"], path);
  if (
    value.version !== 1 ||
    value.algorithm !== "Ed25519" ||
    typeof value.id !== "string" ||
    !/^identity:[0-9a-f]{64}$/.test(value.id)
  )
    fail("SCHEMA_INVALID", "protocol", path);
  bytes(value.publicKey, 32, `${path}/publicKey`);
}
function metadata(value: unknown, path: string, lim: Limits): void {
  if (value !== null && !object(value)) fail("SCHEMA_INVALID", "protocol", path);
  if (value !== null && encodeJson(value, lim.maxDepth).length > lim.maxMetadataBytes)
    fail("RESOURCE_LIMIT", "protocol", path);
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
export function commitSubject(
  input: unknown,
  path: string,
  lim: Limits,
): asserts input is CommitSubject {
  closed(
    input,
    ["version", "suite", "parent", "nonce", "signer", "declaration", "entryIds", "metadata"],
    path,
  );
  if (input.version !== 1 || typeof input.suite !== "string")
    fail("SCHEMA_INVALID", "protocol", path);
  if (input.suite !== "concord-25519-age-v1")
    fail("SUITE_UNSUPPORTED", "protocol", `${path}/suite`);
  if (input.parent !== null) id(input.parent, "commit", `${path}/parent`);
  bytes(input.nonce, 16, `${path}/nonce`);
  publicIdentity(input.signer, `${path}/signer`);
  if (input.declaration !== null) {
    closed(input.declaration, ["system", "model"], `${path}/declaration`);
    ref(input.declaration.system, `${path}/declaration/system`);
    ref(input.declaration.model, `${path}/declaration/model`);
  }
  if (!Array.isArray(input.entryIds) || !input.entryIds.length)
    fail("SCHEMA_INVALID", "protocol", `${path}/entryIds`);
  if (input.entryIds.length > lim.maxEntries)
    fail("RESOURCE_LIMIT", "protocol", `${path}/entryIds`);
  input.entryIds.forEach((value, index) => id(value, "entry", `${path}/entryIds/${index}`));
  metadata(input.metadata, `${path}/metadata`, lim);
}
export function snapshot(input: unknown, lim: Limits): asserts input is Snapshot {
  if (
    object(input) &&
    input.format === "concord" &&
    typeof input.version === "number" &&
    input.version !== 1
  )
    fail("PROTOCOL_UNSUPPORTED", "protocol", "/version");
  closed(input, ["format", "version", "documentId", "head", "commits", "entries", "metadata"], "");
  if (
    input.format !== "concord" ||
    input.version !== 1 ||
    !Array.isArray(input.commits) ||
    !Array.isArray(input.entries) ||
    !input.commits.length
  )
    fail("SCHEMA_INVALID", "protocol", "");
  if (input.commits.length > lim.maxCommits || input.entries.length > lim.maxEntries)
    fail("RESOURCE_LIMIT");
  id(input.documentId, "commit", "/documentId");
  id(input.head, "commit", "/head");
  metadata(input.metadata, "/metadata", lim);
  input.entries.forEach((entry, index) => {
    const p = `/entries/${index}`;
    closed(entry, ["id", "subject"], p);
    id(entry.id, "entry", `${p}/id`);
    entrySubject(entry.subject, `${p}/subject`, lim);
  });
  input.commits.forEach((commit, index) => {
    const p = `/commits/${index}`;
    closed(commit, ["id", "subject", "signature"], p);
    id(commit.id, "commit", `${p}/id`);
    commitSubject(commit.subject, `${p}/subject`, lim);
    bytes(commit.signature, 64, `${p}/signature`);
  });
}

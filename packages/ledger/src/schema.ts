import { decodeBase64Url, validatePublicIdentity } from "@ternent/identity";
import { encodeJson } from "./protocol/json.js";
import { fail } from "./common/errors.js";
import type {
  LedgerSnapshot,
  LedgerLimits,
  LedgerAppendInput,
  LedgerEntrySubject,
  LedgerCommitSubject,
} from "./types.js";

const defaults: LedgerLimits = {
  maxBytes: 16 * 1024 * 1024,
  maxCommits: 10_000,
  maxEntries: 100_000,
  maxDepth: 64,
  maxMetadataBytes: 64 * 1024,
  // Framework ciphertext is opaque JSON here; the total snapshot cap remains authoritative.
  maxPayloadBytes: 16 * 1024 * 1024,
};
export function limits(input: Partial<LedgerLimits> = {}): LedgerLimits {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => !Object.hasOwn(defaults, key))
  )
    fail("HOST_CONFIGURATION", "requirements");
  const output = { ...defaults, ...input };
  if (Object.values(output).some((value) => !Number.isSafeInteger(value) || value <= 0))
    fail("HOST_CONFIGURATION", "requirements");
  return output;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function closed(
  value: unknown,
  keys: readonly string[],
  path: string,
): asserts value is Record<string, unknown> {
  if (
    !record(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail("SCHEMA_INVALID", "protocol", path);
}
function id(value: unknown, kind: "commit" | "entry", path: string): void {
  if (typeof value !== "string" || !new RegExp(`^${kind}:[0-9a-f]{64}$`).test(value))
    fail("SCHEMA_INVALID", "protocol", path);
}
export function bytes(value: unknown, size: number, path: string): Uint8Array {
  if (typeof value !== "string") fail("SCHEMA_INVALID", "protocol", path);
  const decoded = decodeBase64Url(value);
  if (!decoded.ok || decoded.value.length !== size) fail("SCHEMA_INVALID", "protocol", path);
  return decoded.value;
}
export function timestamp(value: unknown): asserts value is string {
  if (
    typeof value !== "string" ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString() !== value
  )
    fail("SCHEMA_INVALID", "protocol");
}
function metadata(value: unknown, lim: LedgerLimits): void {
  if (value !== null && !record(value)) fail("SCHEMA_INVALID", "protocol");
  if (value !== null && encodeJson(value, lim.maxDepth).length > lim.maxMetadataBytes)
    fail("RESOURCE_LIMIT", "protocol");
}
export function appendInput(input: unknown, lim: LedgerLimits): asserts input is LedgerAppendInput {
  if (
    !record(input) ||
    Object.keys(input).some((key) => !["kind", "payload", "meta", "nonce"].includes(key)) ||
    typeof input.kind !== "string" ||
    input.kind.length < 1 ||
    input.kind.length > 128
  )
    fail("SCHEMA_INVALID", "input");
  if (input.nonce !== undefined) bytes(input.nonce, 16, "/nonce");
  metadata(input.meta ?? null, lim);
  if (encodeJson(input.payload ?? null, lim.maxDepth).length > lim.maxPayloadBytes)
    fail("RESOURCE_LIMIT", "input");
}
export function entrySubject(
  input: unknown,
  path: string,
  lim: LedgerLimits,
): asserts input is LedgerEntrySubject {
  closed(
    input,
    ["version", "parent", "nonce", "kind", "author", "authoredAt", "meta", "payload"],
    path,
  );
  const subject = input;
  if (
    subject.version !== 1 ||
    typeof subject.kind !== "string" ||
    subject.kind.length < 1 ||
    subject.kind.length > 128 ||
    typeof subject.author !== "string"
  )
    fail("SCHEMA_INVALID", "protocol", path);
  if (subject.parent !== null) id(subject.parent, "commit", `${path}/parent`);
  bytes(subject.nonce, 16, `${path}/nonce`);
  timestamp(subject.authoredAt);
  metadata(subject.meta, lim);
  closed(subject.payload, ["type", "data"], `${path}/payload`);
  if (subject.payload.type !== "plain") fail("ENTRY_KIND_UNSUPPORTED", "protocol", path);
  if (encodeJson(subject.payload.data, lim.maxDepth).length > lim.maxPayloadBytes)
    fail("RESOURCE_LIMIT", "protocol", path);
}
export function commitSubject(
  input: unknown,
  path: string,
  lim: LedgerLimits,
): asserts input is LedgerCommitSubject {
  closed(
    input,
    ["version", "suite", "parent", "nonce", "signer", "committedAt", "entryIds", "metadata"],
    path,
  );
  const subject = input;
  if (subject.version !== 1 || subject.suite !== "ledger-ed25519-v1")
    fail("SUITE_UNSUPPORTED", "protocol", path);
  if (subject.parent !== null) id(subject.parent, "commit", `${path}/parent`);
  bytes(subject.nonce, 16, `${path}/nonce`);
  if (!record(subject.signer) || !validatePublicIdentity(subject.signer).ok)
    fail("IDENTITY_INVALID", "protocol", path);
  timestamp(subject.committedAt);
  metadata(subject.metadata, lim);
  if (!Array.isArray(subject.entryIds) || subject.entryIds.length > lim.maxEntries)
    fail("SCHEMA_INVALID", "protocol", path);

  subject.entryIds.forEach((entryId, index) => id(entryId, "entry", `${path}/entryIds/${index}`));
}
export function snapshot(input: unknown, lim: LedgerLimits): asserts input is LedgerSnapshot {
  closed(input, ["format", "version", "documentId", "head", "commits", "entries"], "");
  if (input.format !== "ledger" || input.version !== 1) fail("PROTOCOL_UNSUPPORTED", "protocol");
  id(input.documentId, "commit", "/documentId");
  id(input.head, "commit", "/head");
  if (!Array.isArray(input.commits) || !input.commits.length || !Array.isArray(input.entries))
    fail("SCHEMA_INVALID", "protocol");
  if (input.commits.length > lim.maxCommits || input.entries.length > lim.maxEntries)
    fail("RESOURCE_LIMIT", "protocol");
  for (const [index, entry] of input.entries.entries()) {
    const path = `/entries/${index}`;
    closed(entry, ["id", "subject"], path);
    id(entry.id, "entry", `${path}/id`);
    entrySubject(entry.subject, `${path}/subject`, lim);
  }
  let offset = 0;
  for (const [index, commit] of input.commits.entries()) {
    const path = `/commits/${index}`;
    closed(commit, ["id", "subject", "signature"], path);
    id(commit.id, "commit", `${path}/id`);
    commitSubject(commit.subject, `${path}/subject`, lim);
    const subject = commit.subject;
    if (index > 0 && !subject.entryIds.length) fail("SCHEMA_INVALID", "protocol", path);
    for (const [entryIndex, entryId] of subject.entryIds.entries()) {
      id(entryId, "entry", `${path}/subject/entryIds/${entryIndex}`);
      const entry = input.entries[offset++];
      if (record(entry) && record(entry.subject) && entry.subject.author !== subject.signer.id)
        fail("IDENTITY_MISMATCH", "protocol", `/entries/${offset - 1}/subject/author`);
    }
    bytes(commit.signature, 64, `${path}/signature`);
  }
}

import { sha256 } from "@noble/hashes/sha2.js";
import { validatePublicIdentity, verifySignature } from "@ternent/identity";
import { attempt, caught, fail, ok, type Result } from "../common/errors.js";
import { encodeJson, parseJson, utf8 } from "./json.js";
import * as schema from "./schema.js";
import type {
  CommitId,
  CommitRecord,
  CommitSubject,
  EntryId,
  EntrySubject,
  Limits,
  Relationship,
  Snapshot,
  VerificationReport,
} from "./types.js";
const hexadecimal = (value: Uint8Array) =>
  Array.from(value, (v) => v.toString(16).padStart(2, "0")).join("");
export function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}
export function signatureMessage(subject: CommitSubject, depth = 64): Uint8Array {
  return concat(utf8.encode("concord.signature/1\0"), encodeJson(subject, depth));
}
export function identifier(subject: EntrySubject, kind: "entry", depth?: number): EntryId;
export function identifier(subject: CommitSubject, kind: "commit", depth?: number): CommitId;
export function identifier(
  subject: EntrySubject | CommitSubject,
  kind: "entry" | "commit",
  depth = 64,
): EntryId | CommitId {
  return `${kind}:${hexadecimal(sha256(concat(utf8.encode(`concord.${kind}/1\0`), encodeJson(subject, depth))))}`;
}
export function hashEntrySubject(subject: EntrySubject): Result<EntryId> {
  return attempt(() => {
    const safe = parseJson(encodeJson(subject));
    schema.entrySubject(safe, "", schema.defaults);
    return identifier(safe, "entry");
  });
}
export function hashCommitSubject(subject: CommitSubject): Result<CommitId> {
  return attempt(() => {
    const safe = parseJson(encodeJson(subject));
    schema.commitSubject(safe, "", schema.defaults);
    return identifier(safe, "commit");
  });
}
const unsupported = new Set([
  "PROTOCOL_UNSUPPORTED",
  "SUITE_UNSUPPORTED",
  "ENTRY_KIND_UNSUPPORTED",
  "RESOURCE_LIMIT",
  "HOST_CONFIGURATION",
]);
export async function inspectProtocol(
  bytes: Uint8Array,
  options: { limits?: Partial<Limits> } = {},
): Promise<{
  report: VerificationReport;
  snapshot?: Snapshot;
  untrustedHistory: readonly CommitRecord[];
}> {
  const report: VerificationReport = {
    integrity: "invalid",
    documentId: null,
    head: null,
    checkedCommits: 0,
    checkedEntries: 0,
    findings: [],
  };
  let untrustedHistory: readonly CommitRecord[] = [];
  try {
    const lim = schema.limits(options.limits);
    if (bytes.byteLength > lim.maxBytes) fail("RESOURCE_LIMIT");
    const parsed = parseJson(new Uint8Array(bytes), lim.maxDepth, lim.maxBytes);
    schema.snapshot(parsed, lim);
    // Parsed envelopes are inspection evidence; only snapshot grants verified input.
    untrustedHistory = parsed.commits;
    report.documentId = parsed.documentId;
    report.head = parsed.head;
    if (encodeJson(parsed, lim.maxDepth).length > lim.maxBytes) fail("RESOURCE_LIMIT");
    const entryIds = new Set<string>(),
      commitIds = new Set<string>(),
      references = new Set<string>();
    for (let i = 0; i < parsed.entries.length; i++) {
      const record = parsed.entries[i];
      if (entryIds.has(record.id)) fail("DUPLICATE_RECORD", "protocol", `/entries/${i}/id`);
      entryIds.add(record.id);
    }
    const expected: EntryId[] = [];
    const referencePaths: string[] = [];
    for (let i = 0; i < parsed.commits.length; i++) {
      const record = parsed.commits[i];
      if (commitIds.has(record.id)) fail("DUPLICATE_RECORD", "protocol", `/commits/${i}/id`);
      commitIds.add(record.id);
      for (let j = 0; j < record.subject.entryIds.length; j++) {
        const id = record.subject.entryIds[j];
        if (references.has(id))
          fail("DUPLICATE_RECORD", "protocol", `/commits/${i}/subject/entryIds/${j}`);
        references.add(id);
        expected.push(id);
        referencePaths.push(`/commits/${i}/subject/entryIds/${j}`);
      }
    }
    for (let i = 0; i < expected.length; i++)
      if (!entryIds.has(expected[i])) fail("ENTRY_MISSING", "protocol", referencePaths[i]);
    for (let i = 0; i < parsed.entries.length; i++)
      if (!references.has(parsed.entries[i].id))
        fail("UNREFERENCED_RECORD", "protocol", `/entries/${i}`);
    for (let i = 0; i < expected.length; i++)
      if (parsed.entries[i]?.id !== expected[i]) fail("ENTRY_ORDER", "protocol", `/entries/${i}`);
    const selected = parsed.commits.findIndex((commit) => commit.id === parsed.head);
    const linear = parsed.commits.every(
      (commit, index) =>
        commit.subject.parent === (index === 0 ? null : parsed.commits[index - 1].id),
    );
    if (selected >= 0 && selected < parsed.commits.length - 1 && !linear) {
      const records = new Map(parsed.commits.map((commit) => [commit.id, commit]));
      const reachable = new Set<string>();
      let cursor: CommitId | null = parsed.head;
      while (cursor !== null && records.has(cursor) && !reachable.has(cursor)) {
        reachable.add(cursor);
        cursor = records.get(cursor)!.subject.parent;
      }
      const detached = parsed.commits.findIndex((commit) => !reachable.has(commit.id));
      if (detached >= 0) fail("UNREFERENCED_RECORD", "protocol", `/commits/${detached}`);
    }
    for (let i = 0; i < parsed.entries.length; i++) {
      if (identifier(parsed.entries[i].subject, "entry", lim.maxDepth) !== parsed.entries[i].id)
        fail("HASH_MISMATCH", "protocol", `/entries/${i}/id`);
      report.checkedEntries++;
    }
    for (let i = 0; i < parsed.commits.length; i++)
      if (identifier(parsed.commits[i].subject, "commit", lim.maxDepth) !== parsed.commits[i].id)
        fail("HASH_MISMATCH", "protocol", `/commits/${i}/id`);
    let offset = 0;
    for (let i = 0; i < parsed.commits.length; i++) {
      const subject = parsed.commits[i].subject;
      if (subject.parent !== (i === 0 ? null : parsed.commits[i - 1].id))
        fail("LINK_INVALID", "protocol", `/commits/${i}/subject/parent`);
      if ((i === 0) === (subject.declaration === null))
        fail("DECLARATION_INVALID", "protocol", `/commits/${i}/subject/declaration`);
      const nonces = new Set<string>();
      for (let j = 0; j < subject.entryIds.length; j++) {
        const entry = parsed.entries[offset++];
        if (entry.subject.parent !== subject.parent)
          fail("LINK_INVALID", "protocol", `/entries/${offset - 1}/subject/parent`);
        if (nonces.has(entry.subject.nonce))
          fail("SCHEMA_INVALID", "protocol", `/entries/${offset - 1}/subject/nonce`);
        nonces.add(entry.subject.nonce);
      }
    }
    if (parsed.documentId !== parsed.commits[0].id) fail("HEAD_INVALID", "protocol", "/documentId");
    if (parsed.head !== parsed.commits.at(-1)!.id) fail("HEAD_INVALID", "protocol", "/head");
    for (let i = 0; i < parsed.commits.length; i++) {
      const record = parsed.commits[i];
      if (!validatePublicIdentity(record.subject.signer).ok)
        fail("IDENTITY_INVALID", "protocol", `/commits/${i}/subject/signer`);
      const valid = await verifySignature(
        record.subject.signer,
        signatureMessage(record.subject, lim.maxDepth),
        schema.bytes(record.signature, 64, `/commits/${i}/signature`),
      );
      if (!valid.ok || !valid.value)
        fail("SIGNATURE_INVALID", "protocol", `/commits/${i}/signature`);
      report.checkedCommits++;
    }
    report.integrity = "valid";
    return { report, snapshot: parsed, untrustedHistory };
  } catch (cause) {
    const finding = caught(cause, "SCHEMA_INVALID", "protocol");
    report.integrity = unsupported.has(finding.code) ? "unsupported" : "invalid";
    report.findings = [finding];
    return { report, untrustedHistory };
  }
}
export async function verifyDocument(
  bytes: Uint8Array,
  options?: { limits?: Partial<Limits> },
): Promise<VerificationReport> {
  return (await inspectProtocol(bytes, options)).report;
}
export async function compareSnapshots(
  a: Uint8Array,
  b: Uint8Array,
  options?: { limits?: Partial<Limits> },
): Promise<Result<Relationship>> {
  const left = await inspectProtocol(a, options),
    right = await inspectProtocol(b, options);
  if (!left.snapshot) return { ok: false, error: left.report.findings[0] };
  if (!right.snapshot) return { ok: false, error: right.report.findings[0] };
  const x = left.snapshot,
    y = right.snapshot;
  return ok(
    x.documentId !== y.documentId
      ? "unrelated"
      : x.head === y.head
        ? "equal"
        : y.commits.some((c) => c.id === x.head)
          ? "behind"
          : x.commits.some((c) => c.id === y.head)
            ? "ahead"
            : "diverged",
  );
}

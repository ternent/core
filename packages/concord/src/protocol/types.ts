import type { ConcordError } from "../common/errors.js";
export type { PublicIdentity } from "@ternent/identity";
export type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type CommitId = `commit:${string}`;
export type EntryId = `entry:${string}`;
export type ModelRef = { id: string; version: number };
export type Declaration = { system: ModelRef; model: ModelRef };
export type DomainEvent = { type: string; version: number; data: Json };
export type SystemEvent = DomainEvent & { data: JsonObject };
export type GroupId = `group:${string}`;
export type AudienceId = "document" | GroupId;
export type ProtectedEvent = { audience: AudienceId; epoch: number; ciphertext: string };
type EntryBase = { version: 1; parent: CommitId | null; nonce: string };
/** Prepared or replayed framework view; its signed source is RawEntrySubject. */
export type EntrySubject = EntryBase &
  ({ kind: "system"; payload: SystemEvent } | { kind: "application"; payload: ProtectedEvent });
/** Logical replay view retaining the corresponding raw Ledger entry ID. */
export type EntryRecord = { id: EntryId; subject: EntrySubject };
// History records are the shared signed Ledger container. EntrySubject above is a
// prepared/replay view; it is never independently hashed or signed by Concord.
export type CommitSubject = import("@ternent/ledger").LedgerCommitSubject;
export type CommitRecord = import("@ternent/ledger").LedgerCommitRecord;
export type Snapshot = import("@ternent/ledger").LedgerSnapshot;
export type RawEntrySubject = import("@ternent/ledger").LedgerEntrySubject;
export type RawEntryRecord = import("@ternent/ledger").LedgerEntryRecord;
export type Limits = {
  maxBytes: number;
  maxCommits: number;
  maxEntries: number;
  maxCiphertextBytes: number;
  maxDepth: number;
  maxMetadataBytes: number;
};
export type VerificationReport = {
  integrity: "valid" | "invalid" | "unsupported";
  documentId: CommitId | null;
  head: CommitId | null;
  checkedCommits: number;
  checkedEntries: number;
  findings: readonly ConcordError[];
};
export type Relationship = "equal" | "ahead" | "behind" | "diverged" | "unrelated";

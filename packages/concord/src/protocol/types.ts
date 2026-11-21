import type { PublicIdentity } from "@ternent/identity";
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
export type EntrySubject = EntryBase &
  ({ kind: "system"; payload: SystemEvent } | { kind: "application"; payload: ProtectedEvent });
export type EntryRecord = { id: EntryId; subject: EntrySubject };
export type CommitSubject = {
  version: 1;
  suite: "concord-25519-age-v1";
  parent: CommitId | null;
  nonce: string;
  signer: PublicIdentity;
  declaration: Declaration | null;
  entryIds: EntryId[];
  metadata: JsonObject | null;
};
export type CommitRecord = { id: CommitId; subject: CommitSubject; signature: string };
export type Snapshot = {
  format: "concord";
  version: 1;
  documentId: CommitId;
  head: CommitId;
  commits: CommitRecord[];
  entries: EntryRecord[];
  metadata: JsonObject | null;
};
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

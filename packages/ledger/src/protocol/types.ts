import type { HistoryError } from "../common/errors.js";
export type { PublicIdentity } from "@ternent/identity";
export type Json = null | boolean | string | number | Json[] | { [key: string]: Json };
export type JsonObject = { [key: string]: Json };
export type CommitId = `commit:${string}`;
export type EntryId = `entry:${string}`;
export type Relationship = "equal" | "ahead" | "behind" | "diverged" | "unrelated";
export type VerificationReport = {
  integrity: "valid" | "invalid" | "unsupported";
  documentId: CommitId | null;
  head: CommitId | null;
  checkedCommits: number;
  checkedEntries: number;
  findings: readonly HistoryError[];
};

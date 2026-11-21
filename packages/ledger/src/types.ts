import type { BaseIdentityCapability, PublicIdentity } from "@ternent/identity";
import type { Json, JsonObject, CommitId, EntryId, VerificationReport } from "./protocol/index.js";

export type LedgerSigner = Pick<BaseIdentityCapability, "publicIdentity" | "sign">;
export type LedgerPayload = { type: "plain"; data: Json };
export type LedgerEntrySubject = {
  version: 1;
  parent: CommitId | null;
  nonce: string;
  kind: string;
  author: string;
  authoredAt: string;
  meta: JsonObject | null;
  payload: LedgerPayload;
};
export type LedgerEntryRecord = { id: EntryId; subject: LedgerEntrySubject };
export type LedgerCommitSubject = {
  version: 1;
  suite: "ledger-ed25519-v1";
  parent: CommitId | null;
  nonce: string;
  signer: PublicIdentity;
  committedAt: string;
  entryIds: EntryId[];
  metadata: JsonObject | null;
};
export type LedgerCommitRecord = {
  id: CommitId;
  subject: LedgerCommitSubject;
  signature: string;
};
export type LedgerSnapshot = {
  format: "ledger";
  version: 1;
  documentId: CommitId;
  head: CommitId;
  commits: LedgerCommitRecord[];
  entries: LedgerEntryRecord[];
};
export type LedgerLimits = {
  maxBytes: number;
  maxCommits: number;
  maxEntries: number;
  maxDepth: number;
  maxMetadataBytes: number;
  maxPayloadBytes: number;
};
export type LedgerAppendInput = { kind: string; payload?: Json; meta?: JsonObject; nonce?: string };
export type LedgerReplayEntry = LedgerEntrySubject & {
  entryId: EntryId;
  commitId: CommitId | null;
  committed: boolean;
};
export type LedgerProjector<P> = (projection: P, entry: Readonly<LedgerReplayEntry>) => P;
export type LedgerOptions = {
  signer?: LedgerSigner;
  limits?: Partial<LedgerLimits>;
  now?: () => string;
};
export type CreateLedgerConfig<P> = LedgerOptions & {
  initialProjection: P;
  projector: LedgerProjector<P>;
};
export type LedgerState<P> = {
  container: LedgerSnapshot | null;
  staged: readonly LedgerEntryRecord[];
  projection: P;
  verification: VerificationReport | null;
};
export type LedgerInstance<P> = {
  create(input?: { metadata?: JsonObject; entries?: readonly LedgerAppendInput[] }): Promise<void>;
  load(snapshot: LedgerSnapshot | Uint8Array): Promise<void>;
  import(snapshot: LedgerSnapshot | Uint8Array): Promise<void>;
  append(input: LedgerAppendInput): Promise<{ entry: LedgerEntryRecord; stagedCount: number }>;
  appendMany(inputs: readonly LedgerAppendInput[]): Promise<readonly LedgerEntryRecord[]>;
  commit(input?: { metadata?: JsonObject }): Promise<{
    commit: LedgerCommitRecord;
    committedEntries: readonly LedgerEntryRecord[];
    committedEntryIds: readonly EntryId[];
  }>;
  replay(options?: { includeStaged?: boolean }): Promise<P>;
  recompute(): Promise<P>;
  verify(): Promise<VerificationReport>;
  export(): Promise<LedgerSnapshot>;
  getState(): Readonly<LedgerState<P>>;
  subscribe(listener: (state: Readonly<LedgerState<P>>) => void): () => void;
  clearStaged(): Promise<void>;
  destroy(): Promise<void>;
};

import type { IdentityCapability, ReaderCapability } from "@ternent/armour";
import type {
  PublicIdentity,
  CommitId,
  EntryId,
  Json,
  JsonObject,
  ModelRef,
  DomainEvent,
  Limits,
  VerificationReport,
  CommitRecord,
  Relationship,
} from "../protocol/types.js";
import type { Result } from "../common/errors.js";
export type { IdentityCapability, ReaderCapability } from "@ternent/armour";
export type Capability = "read" | "write" | "grant" | "administer";
export type Member = { identity: PublicIdentity; capabilities: readonly Capability[] };
export type SystemFacts = {
  actor: PublicIdentity;
  capabilities: readonly Capability[];
  members: readonly Member[];
};
export type ModelIssue = { code: string; message: string; path?: string };
export type ApplicationModel<
  S extends Json,
  C extends Record<string, Json>,
  E extends DomainEvent = DomainEvent,
> = {
  ref: ModelRef;
  initial(this: void): S;
  commands: {
    [K in keyof C]: {
      validate(this: void, input: unknown): Result<C[K], ModelIssue>;
      decide(
        this: void,
        input: C[K],
        state: Readonly<S>,
        context: { facts: SystemFacts },
      ): Result<readonly E[], ModelIssue>;
    };
  };
  validateEvent(this: void, input: unknown): Result<E, ModelIssue>;
  requirements(this: void, event: E): readonly Capability[];
  reduce(this: void, state: Readonly<S>, event: E, facts: SystemFacts): Result<S, ModelIssue>;
};
export type ReadyState<S> = {
  status: "ready";
  documentId: CommitId;
  head: CommitId;
  projection: Readonly<S>;
  canWrite: boolean;
};
export type InspectionState = {
  status: "inspection";
  reason: "invalid" | "locked" | "incompatible" | "freshness";
};
export type CommitReceipt = { status: "committed"; head: CommitId; entryIds: readonly EntryId[] };
export type DraftReceipt = { status: "staged"; baseHead: CommitId; entryCount: number };
export type DraftState<S> = { baseHead: CommitId; entryCount: number; preview: Readonly<S> };
export type InspectionReport = {
  verification: VerificationReport;
  system: "valid" | "invalid" | "unsupported" | "not-run";
  application: "valid" | "invalid" | "unsupported" | "locked" | "not-run";
  otherRecipientsDecryptability: "unverified";
  freshness: "unanchored" | Relationship;
  requirements: readonly { kind: "system" | "model"; ref: ModelRef }[];
  lockedEntries: number | null;
  findings: readonly import("../common/errors.js").ConcordError[];
  history: readonly CommitRecord[];
};
export interface DocumentHandle<S, C extends Record<string, Json>> {
  state(): ReadyState<S> | InspectionState;
  dispatch<K extends keyof C & string>(
    command: K,
    input: C[K],
  ): Promise<Result<CommitReceipt | DraftReceipt>>;
  commit(metadata?: JsonObject): Promise<Result<CommitReceipt>>;
  discardDraft(): Promise<Result<void>>;
  draft(): DraftState<S> | null;
  export(): Uint8Array;
  verify(): Promise<VerificationReport>;
  replay(): Promise<Result<Readonly<S>>>;
  inspect(): InspectionReport;
}
export type HostOptions<S extends Json, C extends Record<string, Json>, E extends DomainEvent> = {
  model?: ApplicationModel<S, C, E>;
  system?: import("../system/types.js").SystemProfile;
  reader?: ReaderCapability;
  signer?: IdentityCapability;
  mode?: "immediate" | "draft";
  limits?: Partial<Limits>;
  anchor?: Uint8Array;
};

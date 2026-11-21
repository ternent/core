import type { IdentityCapability, ReaderCapability } from "@ternent/armour";
import type { Result } from "../common/errors.js";
import type {
  DomainEvent,
  EntryId,
  EntrySubject,
  Limits,
  ModelRef,
  Declaration,
  CommitId,
  CommitRecord,
  EntryRecord,
  PublicIdentity,
  AudienceId,
  GroupId,
} from "../protocol/types.js";
import type { Capability, SystemFacts, Member } from "../model/types.js";
declare const verified: unique symbol;
export type VerifiedHistory = {
  readonly [verified]: true;
  readonly documentId: CommitId;
  readonly head: CommitId;
  readonly declaration: Declaration;
  readonly ordered: readonly { commit: CommitRecord; entry: EntryRecord }[];
};
export type ApplicationIntent = {
  kind: "application";
  event: DomainEvent;
  required: readonly Capability[];
  audience: AudienceId;
};
export type SystemIntent =
  | { kind: "group.create"; audience: GroupId }
  | {
      kind: "member.set";
      audience: AudienceId;
      identity: PublicIdentity;
      capabilities: readonly Capability[];
    }
  | { kind: "member.remove"; audience: AudienceId; identityId: string };
export type AudienceState = {
  audience: AudienceId;
  members: readonly Member[];
  epochs: readonly { epoch: number; recipient: string }[];
};
export type ReplayItem =
  | { status: "readable"; entryId: EntryId; event: DomainEvent; facts: SystemFacts }
  | { status: "locked"; entryId: EntryId; audience: AudienceId; epoch: number; facts: SystemFacts };
export type SystemReplay = {
  entryFacts: readonly { entryId: EntryId; facts: SystemFacts }[];
  entries: readonly ReplayItem[];
  audiences: readonly AudienceState[];
  reader: PublicIdentity | null;
  session: object;
};
export type SystemProfile = {
  ref: ModelRef;
  bootstrap(
    this: void,
    input: { signer: IdentityCapability; limits: Limits },
  ): Promise<Result<EntrySubject>>;
  replay(
    this: void,
    input: {
      history: VerifiedHistory;
      reader: ReaderCapability | undefined;
      limits: Limits;
    },
  ): Promise<Result<SystemReplay>>;
  prepare(
    this: void,
    input: {
      history: VerifiedHistory;
      current: SystemReplay;
      signer: IdentityCapability;
      intents: readonly (ApplicationIntent | SystemIntent)[];
      limits: Limits;
    },
  ): Promise<Result<readonly EntrySubject[]>>;
};

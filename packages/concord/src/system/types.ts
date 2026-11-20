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
  audience: "document";
};
export type SystemIntent =
  | { kind: "member.set"; identity: PublicIdentity; capabilities: readonly Capability[] }
  | { kind: "member.remove"; identityId: string };
export type SystemReplay = {
  entryFacts: readonly { entryId: EntryId; facts: SystemFacts }[];
  events: readonly { entryId: EntryId; event: DomainEvent; facts: SystemFacts }[];
  members: readonly Member[];
  epochs: readonly { epoch: number; recipient: string }[];
  reader: PublicIdentity;
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

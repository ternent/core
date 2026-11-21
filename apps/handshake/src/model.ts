import { defineModel, type ModelIssue, type Result, type SystemFacts } from "@ternent/concord";
import { canonicalize } from "@ternent/concord/protocol";

export type HandshakeTerms = { recipientId: string; artifactSha256: string };
export type HandshakeProjection = {
  proposal: (HandshakeTerms & { senderId: string }) | null;
  accepted: boolean;
};

type HandshakeCommands = { propose: HandshakeTerms; accept: HandshakeTerms };
type HandshakeEvent = {
  type: "handshake.proposed" | "handshake.accepted";
  version: 1;
  data: HandshakeTerms;
};

function issue(code: string, message: string): { ok: false; error: ModelIssue } {
  return { ok: false, error: { code, message } };
}

function isClosedRecord(input: unknown, keys: readonly string[]): input is Record<string, unknown> {
  return (
    typeof input === "object" &&
    input !== null &&
    !Array.isArray(input) &&
    Reflect.ownKeys(input).length === keys.length &&
    keys.every((key) => Object.hasOwn(input, key)) &&
    canonicalize(input).ok
  );
}

function validateTerms(input: unknown): Result<HandshakeTerms, ModelIssue> {
  if (
    !isClosedRecord(input, ["recipientId", "artifactSha256"]) ||
    typeof input.recipientId !== "string" ||
    !/^identity:[0-9a-f]{64}$/.test(input.recipientId) ||
    typeof input.artifactSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(input.artifactSha256)
  ) {
    return issue("TERMS_INVALID", "Expected a Concord recipient and a lowercase SHA-256 digest.");
  }
  return {
    ok: true,
    value: { recipientId: input.recipientId, artifactSha256: input.artifactSha256 },
  };
}

function reduceHandshake(
  state: Readonly<HandshakeProjection>,
  event: HandshakeEvent,
  facts: SystemFacts,
): Result<HandshakeProjection, ModelIssue> {
  const { proposal, accepted } = state;
  const terms = event.data;
  if (event.type === "handshake.proposed") {
    if (proposal) return issue("PROPOSAL_EXISTS", "This document already has a proposal.");

    const recipient = facts.members.find((member) => member.identity.id === terms.recipientId);
    if (
      facts.actor.id === terms.recipientId ||
      !recipient?.capabilities.includes("read") ||
      !recipient.capabilities.includes("write")
    ) {
      return issue("RECIPIENT_INVALID", "The recipient must be a different active editor.");
    }
    return {
      ok: true,
      value: { proposal: { ...terms, senderId: facts.actor.id }, accepted: false },
    };
  }

  if (!proposal) return issue("PROPOSAL_REQUIRED", "Create a proposal before accepting it.");
  if (accepted) return issue("ALREADY_ACCEPTED", "This proposal has already been accepted.");
  if (facts.actor.id !== proposal.recipientId) {
    return issue("RECIPIENT_REQUIRED", "The designated recipient must sign the acceptance.");
  }
  if (
    terms.recipientId !== proposal.recipientId ||
    terms.artifactSha256 !== proposal.artifactSha256
  ) {
    return issue("TERMS_MISMATCH", "Acceptance must repeat the exact proposal terms.");
  }
  return { ok: true, value: { proposal, accepted: true } };
}

function decide(
  type: HandshakeEvent["type"],
  data: HandshakeTerms,
  state: Readonly<HandshakeProjection>,
  facts: SystemFacts,
): Result<readonly HandshakeEvent[], ModelIssue> {
  const event: HandshakeEvent = { type, version: 1, data };
  const transition = reduceHandshake(state, event, facts);
  return transition.ok ? { ok: true, value: [event] } : transition;
}

export const handshakeModel = defineModel<HandshakeProjection, HandshakeCommands, HandshakeEvent>({
  ref: { id: "ternent.handshake", version: 1 },
  initial: () => ({ proposal: null, accepted: false }),
  commands: {
    propose: {
      validate: validateTerms,
      decide: (input, state, { facts }) => decide("handshake.proposed", input, state, facts),
    },
    accept: {
      validate: validateTerms,
      decide: (input, state, { facts }) => decide("handshake.accepted", input, state, facts),
    },
  },
  validateEvent(input) {
    if (!isClosedRecord(input, ["type", "version", "data"])) {
      return issue("EVENT_INVALID", "Expected a closed handshake event.");
    }
    if (
      input.version !== 1 ||
      (input.type !== "handshake.proposed" && input.type !== "handshake.accepted")
    ) {
      return issue("EVENT_UNSUPPORTED", "Unsupported handshake event type or version.");
    }
    const terms = validateTerms(input.data);
    return terms.ok
      ? { ok: true, value: { type: input.type, version: 1, data: terms.value } }
      : terms;
  },
  requirements: (event) =>
    event.type === "handshake.proposed" ? ["write", "administer"] : ["write"],
  reduce: reduceHandshake,
});

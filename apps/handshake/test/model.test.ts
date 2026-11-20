import type { Member, PublicIdentity, SystemFacts } from "@ternent/concord";
import { assertModelConformance } from "@ternent/concord/testing";
import { expect, test } from "vite-plus/test";
import { handshakeModel, type HandshakeProjection, type HandshakeTerms } from "../src/model.js";

function identity(byte: string): PublicIdentity {
  return {
    version: 1,
    algorithm: "Ed25519",
    id: `identity:${byte.repeat(64)}`,
    publicKey: "fixture",
  };
}

const sender = identity("1");
const recipient = identity("2");
const reviewer = identity("3");
const members: readonly Member[] = [
  { identity: sender, capabilities: ["read", "write", "grant", "administer"] },
  { identity: recipient, capabilities: ["read", "write"] },
  { identity: reviewer, capabilities: ["read"] },
];

function factsFor(actor: PublicIdentity, membership = members): SystemFacts {
  return {
    actor,
    members: membership,
    capabilities: membership.find(({ identity }) => identity.id === actor.id)?.capabilities ?? [],
  };
}

const terms: HandshakeTerms = { recipientId: recipient.id, artifactSha256: "a".repeat(64) };
const proposal = { type: "handshake.proposed", version: 1, data: terms } as const;
const acceptance = { type: "handshake.accepted", version: 1, data: terms } as const;
const proposed: HandshakeProjection = {
  proposal: { senderId: sender.id, ...terms },
  accepted: false,
};
const accepted: HandshakeProjection = { ...proposed, accepted: true };

test("uses closed, versioned schemas for the terms and events", () => {
  expect(handshakeModel.commands.propose.validate(terms)).toEqual({ ok: true, value: terms });
  expect(handshakeModel.validateEvent(acceptance)).toEqual({ ok: true, value: acceptance });

  for (const input of [
    null,
    { ...terms, artifactSha256: "A".repeat(64) },
    { ...terms, artifactSha256: `${terms.artifactSha256}\n` },
    { ...terms, recipientId: "did:key:other" },
    { ...terms, senderId: sender.id },
    { recipientId: recipient.id },
  ]) {
    expect(handshakeModel.commands.accept.validate(input)).toMatchObject({
      ok: false,
      error: { code: "TERMS_INVALID" },
    });
    expect(handshakeModel.validateEvent({ ...proposal, data: input })).toMatchObject({
      ok: false,
      error: { code: "TERMS_INVALID" },
    });
  }

  expect(handshakeModel.validateEvent({ ...proposal, version: 2 })).toMatchObject({
    ok: false,
    error: { code: "EVENT_UNSUPPORTED" },
  });
  expect(handshakeModel.validateEvent({ ...proposal, senderId: sender.id })).toMatchObject({
    ok: false,
    error: { code: "EVENT_INVALID" },
  });
});

test("replays one proposal and acceptance against their historical signer facts", () => {
  const initial = handshakeModel.initial();
  const senderFacts = factsFor(sender);
  const recipientFacts = factsFor(recipient);
  expect(handshakeModel.requirements(proposal)).toEqual(["write", "administer"]);
  expect(handshakeModel.requirements(acceptance)).toEqual(["write"]);
  expect(handshakeModel.commands.propose.decide(terms, initial, { facts: senderFacts })).toEqual({
    ok: true,
    value: [proposal],
  });
  expect(handshakeModel.commands.accept.decide(terms, proposed, { facts: recipientFacts })).toEqual(
    {
      ok: true,
      value: [acceptance],
    },
  );
  expect(
    assertModelConformance(handshakeModel, {
      initial,
      steps: [
        { event: proposal, facts: senderFacts, expected: proposed },
        { event: acceptance, facts: recipientFacts, expected: accepted },
      ],
    }),
  ).toEqual({ ok: true, value: { passed: 3 } });
});

test("rejects invalid historical membership, wrong signers, changed terms and repeated events", () => {
  const initial = handshakeModel.initial();
  const senderFacts = factsFor(sender);
  const recipientFacts = factsFor(recipient);
  for (const recipientId of [sender.id, reviewer.id, identity("4").id]) {
    const wrongProposal = { ...proposal, data: { ...terms, recipientId } };
    expect(handshakeModel.reduce(initial, wrongProposal, senderFacts)).toMatchObject({
      ok: false,
      error: { code: "RECIPIENT_INVALID" },
    });
  }

  const rejected = [
    [initial, acceptance, recipientFacts, "PROPOSAL_REQUIRED"],
    [proposed, proposal, senderFacts, "PROPOSAL_EXISTS"],
    [proposed, acceptance, senderFacts, "RECIPIENT_REQUIRED"],
    [
      proposed,
      { ...acceptance, data: { ...terms, artifactSha256: "b".repeat(64) } },
      recipientFacts,
      "TERMS_MISMATCH",
    ],
    [
      proposed,
      { ...acceptance, data: { ...terms, recipientId: reviewer.id } },
      recipientFacts,
      "TERMS_MISMATCH",
    ],
    [accepted, acceptance, recipientFacts, "ALREADY_ACCEPTED"],
  ] as const;
  for (const [state, event, facts, code] of rejected) {
    expect(handshakeModel.reduce(state, event, facts)).toMatchObject({
      ok: false,
      error: { code },
    });
  }
});

import { describe, expect, it } from "vite-plus/test";
import { createIdentity } from "@ternent/identity";
import { recipientFromIdentity } from "@ternent/armour";
import {
  createSealArtifact,
  decryptSealArtifactPayload,
  verifySealArtifact,
  parseSealArtifactJson,
} from "../src/artifact.js";

async function createSigner() {
  return createIdentity();
}

describe("seal artifact", () => {
  it("creates, verifies, and decrypts an encrypted artifact", async () => {
    const signer = await createSigner();
    const alice = await createIdentity();
    const bob = await createIdentity();
    const aliceRecipient = await recipientFromIdentity(alice);
    const bobRecipient = await recipientFromIdentity(bob);
    const plaintext = new TextEncoder().encode("recipient targeted payload");
    const artifact = await createSealArtifact({
      signer: { identity: signer },
      subjectPath: "dist-manifest.json",
      payload: plaintext,
      recipients: [aliceRecipient, bobRecipient],
    });

    expect(artifact.type).toBe("seal-artifact");
    expect(artifact.version).toBe("1");
    expect(artifact.proof.subject.kind).toBe("artifact");
    const serialized = JSON.stringify(artifact);
    expect(serialized).not.toContain(aliceRecipient);
    expect(serialized).not.toContain(bobRecipient);

    const verification = await verifySealArtifact(artifact);
    expect(verification.valid).toBe(true);
    expect(verification.subjectHash).toBe(artifact.proof.subject.hash);
    expect(artifact.manifest.payloadHash).not.toBe(artifact.proof.subject.hash);

    const decrypted = await decryptSealArtifactPayload({
      artifact,
      identity: bob,
    });
    expect(new TextDecoder().decode(decrypted)).toBe("recipient targeted payload");
  });

  it("maps invalid recipients to seal errors", async () => {
    const signer = await createSigner();

    await expect(
      createSealArtifact({
        signer: { identity: signer },
        subjectPath: "artifact.tar.gz",
        payload: new TextEncoder().encode("secret"),
        recipients: ["bad-recipient"],
      }),
    ).rejects.toMatchObject({
      code: "SEAL_INVALID_RECIPIENT",
      message: "Recipient must be a valid age recipient string.",
    });
  });

  it("fails decryption for unauthorized identities", async () => {
    const signer = await createSigner();
    const recipient = await createIdentity();
    const outsider = await createIdentity();
    const artifact = await createSealArtifact({
      signer: { identity: signer },
      subjectPath: "artifact.tar.gz",
      payload: new TextEncoder().encode("secret"),
      recipients: [await recipientFromIdentity(recipient)],
    });

    await expect(
      decryptSealArtifactPayload({
        artifact,
        identity: outsider,
      }),
    ).rejects.toMatchObject({
      code: "SEAL_DECRYPTION_FAILED",
      message: "Failed to decrypt payload.",
    });
  });
});

describe("artifact integrity boundaries", () => {
  it("rejects changed manifest, payload and proof before returning plaintext", async () => {
    const signer = await createSigner();
    const recipient = await createIdentity();
    const artifact = await createSealArtifact({
      signer: { identity: signer },
      subjectPath: "private.bin",
      payload: new TextEncoder().encode("authenticated plaintext"),
      recipients: [await recipientFromIdentity(recipient)],
    });
    const changes: ((value: typeof artifact) => void)[] = [
      (value) => {
        value.manifest.payloadHash = `sha256:${"0".repeat(64)}`;
      },
      (value) => {
        value.payload.data += "modified";
      },
      (value) => {
        value.proof.subject.path = "other.bin";
      },
      (value) => {
        value.proof.signature = "!";
      },
      (value) => {
        Object.assign(value.manifest, { recipients: ["unexpected public routing"] });
      },
    ];
    for (const change of changes) {
      const altered = structuredClone(artifact);
      change(altered);
      await expect(verifySealArtifact(altered)).resolves.toMatchObject({ valid: false });
      await expect(
        decryptSealArtifactPayload({ artifact: altered, identity: recipient }),
      ).rejects.toThrow();
    }
    expect(
      new TextDecoder().decode(await decryptSealArtifactPayload({ artifact, identity: recipient })),
    ).toBe("authenticated plaintext");
  });

  it("rejects unsupported encryption metadata and malformed artifact JSON", async () => {
    const signer = await createSigner();
    const artifact = await createSealArtifact({
      signer: { identity: signer },
      subjectPath: "private.bin",
      payload: new Uint8Array([1, 2, 3]),
      recipients: [await recipientFromIdentity(signer)],
    });
    for (const mode of ["passphrase", "unsupported"]) {
      const altered = structuredClone(artifact);
      Object.assign(altered.payload, { mode });
      await expect(verifySealArtifact(altered)).resolves.toMatchObject({ valid: false });
    }
    expect(parseSealArtifactJson("not-json").ok).toBe(false);
    expect(parseSealArtifactJson('{"version":"1","type":"seal-artifact"}').ok).toBe(false);
  });
});

it("captures artifact authoring, verification and decryption inputs before asynchronous work", async () => {
  const signer = await createIdentity();
  const recipient = await createIdentity();
  const recipientValue = await recipientFromIdentity(recipient);
  const input = {
    signer: { identity: signer },
    subjectPath: "captured.bin",
    createdAt: "2026-11-20T00:00:00.000Z",
    payload: new TextEncoder().encode("captured plaintext"),
    recipients: [recipientValue],
  };
  const creating = createSealArtifact(input);
  input.payload.fill(0);
  input.recipients[0] = "caller-mutated-recipient";
  input.subjectPath = "caller-mutated.bin";
  input.createdAt = "2026-11-21T00:00:00.000Z";
  signer.material.seed = Buffer.alloc(32).toString("base64url");
  const artifact = await creating;
  expect(artifact.proof.subject.path).toBe("captured.bin");
  expect(artifact.proof.createdAt).toBe("2026-11-20T00:00:00.000Z");
  expect(await verifySealArtifact(artifact)).toMatchObject({ valid: true });
  expect(
    new TextDecoder().decode(await decryptSealArtifactPayload({ artifact, identity: recipient })),
  ).toBe("captured plaintext");

  const evidence = structuredClone(artifact);
  const checking = verifySealArtifact(evidence);
  evidence.manifest.payloadHash = `sha256:${"0".repeat(64)}`;
  evidence.payload.data = "caller-mutated-ciphertext";
  expect(await checking).toMatchObject({ valid: true });
  const decryptingArtifact = structuredClone(artifact);
  const identity = structuredClone(recipient);
  const decrypting = decryptSealArtifactPayload({ artifact: decryptingArtifact, identity });
  decryptingArtifact.payload.data = "caller-mutated-ciphertext";
  identity.material.seed = Buffer.alloc(32).toString("base64url");
  expect(new TextDecoder().decode(await decrypting)).toBe("captured plaintext");
});

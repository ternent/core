import { createHash, createPublicKey, verify } from "node:crypto";
import { describe, expect, it, vi } from "vite-plus/test";
import { createIdentity, deriveKeyId } from "@ternent/identity";
import {
  createSealHash,
  createSealProof,
  createSealPublicKeyArtifact,
  getSealProofSigningPayload,
  validateSealProofShape,
  parseSealProofJson,
  verifySealProofAgainstBytes,
  verifySealProofSignature,
} from "../src/proof.js";

import { sealVector } from "./fixtures.js";

async function createSigner() {
  const identity = await createIdentity();
  return {
    identity,
    publicKey: identity.publicKey,
    keyId: await deriveKeyId(identity.publicKey),
  };
}

describe("seal proof", () => {
  it("signs and verifies a valid proof", async () => {
    const signer = await createSigner();
    const bytes = new TextEncoder().encode("seal proof bytes");
    const proof = await createSealProof({
      signer: { identity: signer.identity },
      subject: {
        kind: "file",
        path: "sample.txt",
        hash: await createSealHash(bytes),
      },
    });

    const signatureCheck = await verifySealProofSignature(proof);
    const verification = await verifySealProofAgainstBytes(proof, bytes);

    expect(signatureCheck.ok).toBe(true);
    expect(verification.valid).toBe(true);
    expect(verification.keyId).toBe(signer.keyId);
  });

  it("rejects invalid proof JSON", () => {
    const parsed = parseSealProofJson("not-json");

    expect(parsed.ok).toBe(false);
    expect(parsed.errors[0]).toContain("not valid JSON");
  });

  it("creates a portable public-key artifact", async () => {
    const signer = await createSigner();
    const artifact = await createSealPublicKeyArtifact({
      identity: signer.identity,
    });

    expect(artifact.publicKey).toBe(signer.publicKey);
    expect(artifact.keyId).toBe(signer.keyId);
    expect(artifact.version).toBe("2");
    expect(artifact.type).toBe("seal-public-key");
  });
});

describe("independent fixed proof v2", () => {
  it("matches saved canonical payload, context, hash and Node Ed25519 signature bytes", async () => {
    const fixed = sealVector();
    const bytes = new TextEncoder().encode(fixed.contentUtf8);
    expect(await createSealHash(bytes)).toBe(fixed.subjectHash);
    expect(`sha256:${createHash("sha256").update(bytes).digest("hex")}`).toBe(fixed.subjectHash);
    expect(getSealProofSigningPayload(fixed.proof)).toBe(fixed.signingPayload);
    const message = Buffer.concat([
      Buffer.from(fixed.context),
      Buffer.from([0]),
      Buffer.from(fixed.signingPayload),
    ]);
    expect(message.toString("hex")).toBe(fixed.messageHex);
    const publicKey = createPublicKey({
      key: Buffer.concat([
        Buffer.from("302a300506032b6570032100", "hex"),
        Buffer.from(fixed.identity.publicKey, "base64url"),
      ]),
      format: "der",
      type: "spki",
    });
    expect(verify(null, message, publicKey, Buffer.from(fixed.proof.signature, "base64url"))).toBe(
      true,
    );
    expect(
      verify(
        null,
        Buffer.from(fixed.signingPayload),
        publicKey,
        Buffer.from(fixed.proof.signature, "base64url"),
      ),
    ).toBe(false);
    expect(
      await createSealProof({
        createdAt: fixed.proof.createdAt,
        signer: { identity: fixed.identity },
        subject: fixed.proof.subject,
      }),
    ).toEqual(fixed.proof);
    expect(await verifySealProofAgainstBytes(fixed.proof, bytes)).toMatchObject({
      valid: true,
      hashMatch: true,
      signatureValid: true,
    });
  });

  it("binds all subject, timestamp and signer fields rather than just the content hash", async () => {
    const fixed = sealVector();
    const other = await createSigner();
    const changes: ((proof: typeof fixed.proof) => void)[] = [
      (proof) => {
        proof.subject.kind = "manifest";
      },
      (proof) => {
        proof.subject.path = "different.txt";
      },
      (proof) => {
        proof.subject.hash = `sha256:${"0".repeat(64)}`;
      },
      (proof) => {
        proof.createdAt = "2026-11-21T00:00:00.000Z";
      },
      (proof) => {
        proof.signer.publicKey = other.publicKey;
      },
      (proof) => {
        proof.signer.keyId = other.keyId;
      },
      (proof) => {
        proof.signer = { publicKey: other.publicKey, keyId: other.keyId };
      },
      (proof) => {
        proof.signature = `${proof.signature[0] === "A" ? "B" : "A"}${proof.signature.slice(1)}`;
      },
    ];
    for (const change of changes) {
      const proof = structuredClone(fixed.proof);
      change(proof);
      expect(await verifySealProofSignature(proof)).toMatchObject({ ok: false });
      expect(
        await verifySealProofAgainstBytes(proof, new TextEncoder().encode(fixed.contentUtf8)),
      ).toMatchObject({ valid: false });
    }
    expect(
      await verifySealProofAgainstBytes(fixed.proof, new TextEncoder().encode("changed content")),
    ).toMatchObject({ valid: false, signatureValid: true, hashMatch: false });
  });

  it("returns failed verification for malformed key and signature encodings without throwing", async () => {
    const fixed = sealVector();
    for (const encoding of ["!", "A", "AA==", "_", "A".repeat(43), "A".repeat(85)]) {
      const key = structuredClone(fixed.proof);
      key.signer.publicKey = encoding;
      await expect(verifySealProofSignature(key)).resolves.toMatchObject({ ok: false });
      const signature = structuredClone(fixed.proof);
      signature.signature = encoding;
      await expect(verifySealProofSignature(signature)).resolves.toMatchObject({ ok: false });
    }
  });

  it("rejects non-JSON proof fields without invoking host getters", async () => {
    const fixed = sealVector();
    const getter = vi.fn(() => fixed.proof.subject);
    const hostile = { ...fixed.proof };
    Object.defineProperty(hostile, "subject", { enumerable: true, get: getter });
    expect(validateSealProofShape(hostile).ok).toBe(false);
    await expect(verifySealProofSignature(hostile)).resolves.toMatchObject({ ok: false });
    expect(getter).not.toHaveBeenCalled();
    expect(() => getSealProofSigningPayload(hostile)).toThrow();
    expect(getter).not.toHaveBeenCalled();
    const invalidUnicode = structuredClone(fixed.proof);
    invalidUnicode.subject.path = "unpaired-\ud800";
    expect(validateSealProofShape(invalidUnicode).ok).toBe(false);
  });
});

it("captures proof authoring and verification inputs before asynchronous signing or hashing", async () => {
  const fixed = sealVector();
  const identity = structuredClone(fixed.identity);
  const input = {
    createdAt: fixed.proof.createdAt,
    signer: { identity },
    subject: structuredClone(fixed.proof.subject),
  };
  const creating = createSealProof(input);
  input.createdAt = "2026-11-21T00:00:00.000Z";
  input.subject.path = "caller-mutated.txt";
  identity.material.seed = Buffer.alloc(32).toString("base64url");
  expect(await creating).toEqual(fixed.proof);

  const proof = structuredClone(fixed.proof);
  const bytes = new TextEncoder().encode(fixed.contentUtf8);
  const checking = verifySealProofAgainstBytes(proof, bytes);
  proof.subject.path = "mutated during verification.txt";
  proof.signature = "!";
  bytes.fill(0);
  expect(await checking).toMatchObject({ valid: true, signatureValid: true, hashMatch: true });
});

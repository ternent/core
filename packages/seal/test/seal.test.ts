import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { base64urlnopad, hex } from "@scure/base";
import { createIdentity, restoreIdentity, type Identity } from "@ternent/identity";
import * as api from "../src/index.js";
import { createSealHash, createSealProof, verifySealProof, type SealProof } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("vectors.json", import.meta.url), "utf8")) as {
  rfc8032: { seedHex: string; proof: SealProof };
  ledger: { subjectUtf8: string; signatureMessageUtf8: string; proof: SealProof }[];
};
const utf8 = (text: string) => new TextEncoder().encode(text);

async function rfc8032Identity(): Promise<Identity> {
  const { signer } = vectors.rfc8032.proof;
  return restoreIdentity(
    JSON.stringify({
      format: "ternent-identity",
      version: "2",
      algorithm: "Ed25519",
      createdAt: "2026-01-01T00:00:00.000Z",
      publicKey: signer.publicKey,
      keyId: signer.id.slice("identity:".length),
      material: { kind: "seed", seed: base64urlnopad.encode(hex.decode(vectors.rfc8032.seedHex)) },
    }),
  );
}

test("the public interface is the three Seal operations", () => {
  expect(Object.keys(api).sort()).toEqual(["createSealHash", "createSealProof", "verifySealProof"]);
});

test("createSealHash is lowercase SHA-256 with a sha256: prefix", async () => {
  expect(await createSealHash(new Uint8Array())).toBe(vectors.rfc8032.proof.subject.hash);
});

test("authoring reproduces the fixed RFC 8032 vector byte for byte", async () => {
  const identity = await rfc8032Identity();
  const { createdAt, subject } = vectors.rfc8032.proof;
  const proof = await createSealProof({ signer: identity, subject, createdAt });
  expect(JSON.stringify(proof)).toBe(JSON.stringify(vectors.rfc8032.proof));
  expect(await verifySealProof(proof, new Uint8Array())).toEqual({
    valid: true,
    signatureValid: true,
    hashMatch: true,
  });
});

test("the signing message matches the Ledger vector regardless of signer field order", async () => {
  for (const { subjectUtf8, signatureMessageUtf8, proof } of vectors.ledger) {
    expect(await verifySealProof(proof, utf8(subjectUtf8))).toMatchObject({ valid: true });
    const { publicKey, id, algorithm, version } = proof.signer;
    const signed: Uint8Array[] = [];
    const recorder = {
      publicIdentity: { id, publicKey, algorithm, version },
      sign: async (bytes: Uint8Array) => {
        signed.push(bytes.slice());
        return base64urlnopad.decode(proof.signature);
      },
    };
    const created = await createSealProof({
      signer: recorder,
      subject: proof.subject,
      createdAt: proof.createdAt,
    });
    expect(new TextDecoder().decode(signed[0])).toBe(signatureMessageUtf8);
    expect(JSON.stringify(created)).toBe(JSON.stringify(proof));
  }
});

test("tampering with any signed field or the bytes fails the matching check", async () => {
  const { proof } = vectors.rfc8032;
  const bytes = new Uint8Array();
  const other = (await createIdentity()).publicIdentity;
  const flipped = base64urlnopad.decode(proof.signature);
  flipped[10] ^= 1;
  const cases: [unknown, Uint8Array<ArrayBuffer>, boolean, boolean][] = [
    [proof, utf8("x"), true, false],
    [{ ...proof, subject: { hash: `sha256:${"0".repeat(64)}` } }, bytes, false, false],
    [{ ...proof, createdAt: "2026-11-26T12:00:01.000Z" }, bytes, false, true],
    [{ ...proof, signer: other }, bytes, false, true],
    [{ ...proof, signer: { ...proof.signer, id: other.id } }, bytes, false, true],
    [{ ...proof, signature: base64urlnopad.encode(flipped) }, bytes, false, true],
  ];
  for (const [input, data, signatureValid, hashMatch] of cases) {
    expect(await verifySealProof(input, data)).toEqual({ valid: false, signatureValid, hashMatch });
  }
});

test("malformed proofs verify as invalid without throwing", async () => {
  const { proof } = vectors.rfc8032;
  const { signature: _signature, ...unsigned } = proof;
  for (const input of [
    null,
    "proof",
    {},
    unsigned,
    { ...proof, extra: true },
    { ...proof, version: 2 },
    { ...proof, format: "other" },
    { ...proof, createdAt: "2026-11-26T12:00:00Z" },
    { ...proof, createdAt: "2026-02-30T12:00:00.000Z" },
    { ...proof, subject: { hash: proof.subject.hash.toUpperCase() } },
    { ...proof, subject: { ...proof.subject, path: "x" } },
    { ...proof, signer: { ...proof.signer, extra: true } },
    { ...proof, signature: `${proof.signature}=` },
    { ...proof, signature: proof.signature.slice(0, -2) },
  ]) {
    expect((await verifySealProof(input, new Uint8Array())).valid).toBe(false);
  }
});

test("authoring captures inputs at call time and gives the signer a copy", async () => {
  const identity = await createIdentity();
  const bytes = utf8("content");
  const subject = { hash: await createSealHash(bytes) };
  const publicIdentity = { ...identity.publicIdentity };
  const pending = createSealProof({
    subject,
    signer: {
      publicIdentity,
      sign: async (message) => {
        const signature = await identity.sign(message);
        message.fill(0);
        return signature;
      },
    },
  });
  subject.hash = `sha256:${"0".repeat(64)}`;
  publicIdentity.publicKey = "changed";
  const proof = await pending;
  expect(proof.signer).toEqual(identity.publicIdentity);
  expect((await verifySealProof(proof, bytes)).valid).toBe(true);
});

test("authoring rejects bad subjects, timestamps and signatures that do not verify", async () => {
  const identity = await createIdentity();
  const subject = { hash: await createSealHash(new Uint8Array()) };
  await expect(
    createSealProof({ signer: identity, subject: { hash: "sha256:abc" as never } }),
  ).rejects.toThrow();
  await expect(
    createSealProof({ signer: identity, subject, createdAt: "yesterday" }),
  ).rejects.toThrow();
  const wrongKey = await createIdentity();
  for (const sign of [wrongKey.sign, async () => new Uint8Array(63)]) {
    await expect(
      createSealProof({ signer: { publicIdentity: identity.publicIdentity, sign }, subject }),
    ).rejects.toThrow();
  }
});

test("a manifest and an armored ciphertext use the same proof path", async () => {
  const identity = await createIdentity();
  const manifest = utf8(JSON.stringify({ release: "1.0.0", files: { "a.js": "sha256:..." } }));
  const armored =
    "-----BEGIN AGE ENCRYPTED FILE-----\r\nYWdl\r\n-----END AGE ENCRYPTED FILE-----\r\n";
  for (const bytes of [manifest, utf8(armored)]) {
    const proof = await createSealProof({
      signer: identity,
      subject: { hash: await createSealHash(bytes) },
    });
    expect((await verifySealProof(proof, bytes)).valid).toBe(true);
  }
  const proof = await createSealProof({
    signer: identity,
    subject: { hash: await createSealHash(utf8(armored)) },
  });
  expect((await verifySealProof(proof, utf8(armored.replaceAll("\r\n", "\n")))).hashMatch).toBe(
    false,
  );
});

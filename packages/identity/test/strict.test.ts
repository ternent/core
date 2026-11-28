import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64urlnopad, bech32, hex } from "@scure/base";
import {
  restoreIdentity,
  validatePublicIdentity,
  verify,
  type PublicIdentity,
} from "../src/index.js";

const vector = JSON.parse(readFileSync(new URL("vectors.json", import.meta.url), "utf8")).seed as {
  seedHex: string;
  public: PublicIdentity;
  x25519SecretHex: string;
  ageRecipient: string;
  ageSecretKey: string;
  rfc8032EmptyMessageSignatureHex: string;
};

const backup = JSON.stringify({
  format: "ternent-identity",
  version: "2",
  algorithm: "Ed25519",
  createdAt: "2026-01-01T00:00:00.000Z",
  publicKey: vector.public.publicKey,
  keyId: vector.public.id.slice("identity:".length),
  material: { kind: "seed", seed: base64urlnopad.encode(hex.decode(vector.seedHex)) },
});

test("a restored seed matches the independent signature and age vectors", async () => {
  const identity = await restoreIdentity(backup);
  expect(identity.publicIdentity).toEqual(vector.public);
  const signature = await identity.sign(new Uint8Array());
  expect(hex.encode(signature)).toBe(vector.rfc8032EmptyMessageSignatureHex);
  expect(await verify(vector.public, new Uint8Array(), signature)).toBe(true);
  await identity.withX25519Secret((secret) => {
    expect(hex.encode(secret)).toBe(vector.x25519SecretHex);
    expect(bech32.encode("age", bech32.toWords(x25519.getPublicKey(secret)))).toBe(
      vector.ageRecipient,
    );
    expect(bech32.encode("age-secret-key-", bech32.toWords(secret)).toUpperCase()).toBe(
      vector.ageSecretKey,
    );
  });
});

test("identity binding, non-canonical, small-order and mixed-order keys fail validation", async () => {
  expect(() =>
    validatePublicIdentity({ ...vector.public, id: `identity:${"0".repeat(64)}` }),
  ).toThrow();
  const mixed = ed25519.Point.BASE.add(
    ed25519.Point.fromBytes(hex.decode(`ec${"ff".repeat(30)}7f`), false),
  ).toBytes();
  for (const bytes of [
    new Uint8Array(32),
    hex.decode(`01${"00".repeat(31)}`),
    hex.decode(`ed${"ff".repeat(30)}7f`),
    mixed,
  ]) {
    const publicIdentity = {
      ...vector.public,
      publicKey: base64urlnopad.encode(bytes),
      id: `identity:${hex.encode(sha256(bytes))}`,
    };
    expect(() => validatePublicIdentity(publicIdentity)).toThrow();
    expect(await verify(publicIdentity, new Uint8Array(), new Uint8Array(64))).toBe(false);
  }
});

test("signature R and S are strictly validated", async () => {
  const signature = hex.decode(vector.rfc8032EmptyMessageSignatureHex);
  const smallR = signature.slice();
  smallR.fill(0, 0, 32);
  smallR[0] = 1;
  const badS = signature.slice();
  badS.fill(255, 32);
  for (const invalid of [smallR, badS]) {
    expect(await verify(vector.public, new Uint8Array(), invalid)).toBe(false);
  }
});

import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hex } from "@scure/base";
import {
  signerFromSeed,
  validatePublicIdentity,
  verifySignature,
  ageRecipientFromSecret,
  ageSecretKey,
  encodeBase64Url,
  type PrimitiveResult,
  type PublicIdentity,
} from "../src/index.js";
const vector = JSON.parse(
  readFileSync(new URL("../../../docs/concord/vectors/primitives.json", import.meta.url), "utf8"),
).identity as {
  seedHex: string;
  public: PublicIdentity;
  x25519SecretHex: string;
  ageRecipient: string;
  ageSecretKey: string;
  rfc8032EmptyMessageSignatureHex: string;
};
function value<T>(result: PrimitiveResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
test("P05: retained derivation primitives match the independent raw signature and age vector", async () => {
  const seed = hex.decode(vector.seedHex);
  const signer = value(await signerFromSeed(seed));
  seed.fill(0);
  expect(signer.publicIdentity).toEqual(vector.public);
  const signature = value(await signer.sign(new Uint8Array()));
  expect(hex.encode(signature)).toBe(vector.rfc8032EmptyMessageSignatureHex);
  expect(value(await verifySignature(vector.public, new Uint8Array(), signature))).toBe(true);
  let borrowed: Uint8Array | undefined;
  await signer.withX25519Secret(async (secret) => {
    borrowed = secret;
    await Promise.resolve();
    expect(hex.encode(secret)).toBe(vector.x25519SecretHex);
    expect(ageRecipientFromSecret(secret)).toBe(vector.ageRecipient);
    expect(ageSecretKey(secret)).toBe(vector.ageSecretKey);
  });
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  await expect(
    signer.withX25519Secret((secret) => {
      borrowed = secret;
      throw new Error("callback");
    }),
  ).rejects.toThrow("callback");
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
});
test("P06/P07: identity binding, noncanonical, small and mixed-order points fail strict validation", () => {
  expect(
    validatePublicIdentity({ ...vector.public, id: `identity:${"0".repeat(64)}` }),
  ).toMatchObject({ ok: false });
  const mixed = ed25519.Point.BASE.add(
    ed25519.Point.fromBytes(hex.decode(`ec${"ff".repeat(30)}7f`), false),
  ).toBytes();
  for (const bytes of [
    new Uint8Array(32),
    hex.decode(`01${"00".repeat(31)}`),
    hex.decode(`ed${"ff".repeat(30)}7f`),
    mixed,
  ]) {
    expect(
      validatePublicIdentity({
        ...vector.public,
        publicKey: encodeBase64Url(bytes),
        id: `identity:${hex.encode(sha256(bytes))}`,
      }),
    ).toMatchObject({ ok: false });
  }
});
test("P07: signature R and S are strictly validated", async () => {
  const signature = hex.decode(vector.rfc8032EmptyMessageSignatureHex);
  const smallR = signature.slice();
  smallR.fill(0, 0, 32);
  smallR[0] = 1;
  const badS = signature.slice();
  badS.fill(255, 32);
  for (const invalid of [smallR, badS])
    expect(await verifySignature(vector.public, new Uint8Array(), invalid)).toMatchObject({
      ok: false,
      error: { code: "SIGNATURE_INVALID" },
    });
});

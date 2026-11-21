import { expect, test } from "vite-plus/test";
import { ageRecipientFromPublicIdentity, type PrimitiveResult } from "@ternent/identity";
import { createAgeCodec, identityFromSeed } from "../src/index.js";

function value<T>(result: PrimitiveResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
test("age codec composes recipients and reader capabilities without Ledger or Concord", async () => {
  const alice = value(await identityFromSeed(new Uint8Array(32).fill(4)));
  const bob = value(await identityFromSeed(new Uint8Array(32).fill(5)));
  const recipients = [value(ageRecipientFromPublicIdentity(alice.publicIdentity))];
  const writer = createAgeCodec({ recipients });
  recipients[0] = value(ageRecipientFromPublicIdentity(bob.publicIdentity));
  const plaintext = new TextEncoder().encode("private payload");
  const encrypted = await writer.encode!(plaintext);
  expect(await createAgeCodec({ reader: alice }).decode!(encrypted)).toEqual(plaintext);
  expect(await createAgeCodec({ reader: bob }).decode!(encrypted)).toBeNull();
  const tampered = new Uint8Array(encrypted);
  tampered[tampered.length - 1] ^= 1;
  expect(await createAgeCodec({ reader: alice }).decode!(tampered)).toBeNull();
  expect(createAgeCodec()).toEqual({ id: "age" });
  expect(writer.decode).toBeUndefined();
  expect(createAgeCodec({ reader: alice }).encode).toBeUndefined();
  const empty = await writer.encode!(new Uint8Array());
  expect(await createAgeCodec({ reader: alice }).decode!(empty)).toEqual(new Uint8Array());
});
test("invalid configuration rejects and reader implementation exceptions are not hidden as locked data", async () => {
  for (const input of [null, [], { recipients: [] }, { recipients: ["bad"] }, { reader: {} }])
    expect(() => createAgeCodec(input as never)).toThrow();
  const codec = createAgeCodec({
    reader: {
      decryptAge: async () => {
        throw new Error("device unavailable");
      },
    },
  });
  await expect(codec.decode!(new Uint8Array([1]))).rejects.toThrow("device unavailable");
  const unavailable = createAgeCodec({
    reader: {
      decryptAge: async () => ({
        ok: false,
        error: { code: "DEVICE_UNAVAILABLE", message: "device unavailable" },
      }),
    },
  });
  await expect(unavailable.decode!(new Uint8Array([1]))).rejects.toMatchObject({
    code: "ARMOUR_DECRYPT_FAILED",
  });
});

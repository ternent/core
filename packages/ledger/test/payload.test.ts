import { expect, test } from "vite-plus/test";
import {
  createLedger,
  encodePayload,
  decodePayload,
  type LedgerPayloadCodec,
} from "../src/index.js";
import { signerFromSeed } from "@ternent/identity";

// A transport codec proves that payload integration is independent of encryption.
const codec: LedgerPayloadCodec = {
  id: "test.reverse",
  encode: async (bytes) => new Uint8Array(bytes).reverse(),
  decode: async (bytes) => new Uint8Array(bytes).reverse(),
};
test("host codecs round-trip through ordinary staging, committed export and replay", async () => {
  const signer = await signerFromSeed(new Uint8Array(32).fill(4));
  if (!signer.ok) throw new Error(signer.error.code);
  const log = await createLedger({ signer: signer.value });
  await log.create();
  const encoded = await encodePayload({ value: "payload" }, codec);
  await log.appendMany([
    { kind: "plain", payload: false },
    { kind: "encoded", payload: encoded },
  ]);
  expect((await log.export()).entries).toHaveLength(0);
  expect((await log.replay())[1].committed).toBe(false);
  await log.commit();
  const before = await log.export();
  const reader = await createLedger();
  await reader.load(before);
  const entries = await reader.replay();
  expect(await decodePayload(entries[0].payload.data, codec)).toEqual({
    status: "plain",
    data: false,
  });
  expect(await decodePayload(entries[1].payload.data, codec)).toEqual({
    status: "decoded",
    data: { value: "payload" },
  });
  expect(await decodePayload(encoded)).toEqual({ status: "locked", codec: codec.id });
  expect(
    await decodePayload(encoded, {
      id: "another",
      decode: async () => {
        throw new Error("must not run");
      },
    }),
  ).toEqual({ status: "locked", codec: codec.id });
  expect(await decodePayload(encoded, { id: codec.id })).toEqual({
    status: "locked",
    codec: codec.id,
  });
  expect(await decodePayload(encoded, { id: codec.id, decode: async () => null })).toEqual({
    status: "locked",
    codec: codec.id,
  });
  expect(await reader.export()).toEqual(before);
  expect((await reader.verify()).integrity).toBe("valid");
});
test("failed encoding never appends plaintext; codec and malformed payload failures stay explicit", async () => {
  const broken = {
    id: "failed",
    encode: async () => {
      throw new Error("unavailable");
    },
  };
  await expect(encodePayload("secret", broken)).rejects.toThrow("unavailable");
  await expect(encodePayload("secret", { id: "read-only" })).rejects.toMatchObject({
    finding: { code: "HOST_CONFIGURATION" },
  });
  await expect(
    encodePayload("secret", { id: "Bad ID", encode: codec.encode }),
  ).rejects.toMatchObject({ finding: { code: "HOST_CONFIGURATION" } });
  const payload = await encodePayload("secret", codec);
  for (const malformed of [
    { ...payload, version: 2 },
    { ...payload, data: "non-canonical=" },
    { ...payload, extra: true },
    { ...payload, codec: "" },
  ])
    await expect(decodePayload(malformed, codec)).rejects.toMatchObject({
      finding: { code: "PAYLOAD_INVALID" },
    });
  await expect(
    decodePayload(payload, {
      id: codec.id,
      decode: async () => {
        throw new Error("reader failed");
      },
    }),
  ).rejects.toThrow("reader failed");
  await expect(
    decodePayload(payload, {
      id: codec.id,
      decode: async () => new TextEncoder().encode('{"duplicate":1,"duplicate":2}'),
    }),
  ).rejects.toMatchObject({ finding: { code: "JSON_INVALID" } });
  await expect(
    encodePayload("secret", { id: "invalid", encode: async () => null as never }),
  ).rejects.toMatchObject({ finding: { code: "PAYLOAD_CODEC_INVALID" } });
  await expect(
    decodePayload(payload, { id: codec.id, decode: async () => "bad" as never }),
  ).rejects.toMatchObject({ finding: { code: "PAYLOAD_CODEC_INVALID" } });
});
test("codec calls capture portable JSON before awaiting and enforce encoded and decoded limits", async () => {
  const input = { value: "before" };
  const pending = encodePayload(input, codec);
  input.value = "after";
  expect(await decodePayload(await pending, codec)).toEqual({
    status: "decoded",
    data: { value: "before" },
  });
  await expect(encodePayload("x".repeat(100), codec, { maxBytes: 16 })).rejects.toMatchObject({
    finding: { code: "RESOURCE_LIMIT" },
  });
  await expect(
    encodePayload(
      null,
      { id: "large", encode: async () => new Uint8Array(128) },
      { maxBytes: 100 },
    ),
  ).rejects.toMatchObject({ finding: { code: "RESOURCE_LIMIT" } });
  await expect(
    encodePayload(null, { id: "large", encode: async () => new Uint8Array(64) }, { maxBytes: 100 }),
  ).rejects.toMatchObject({ finding: { code: "RESOURCE_LIMIT" } });
  const payload = await encodePayload(null, codec);
  await expect(
    decodePayload(
      payload,
      { id: codec.id, decode: async () => new Uint8Array(129) },
      { maxBytes: 128 },
    ),
  ).rejects.toMatchObject({ finding: { code: "RESOURCE_LIMIT" } });
});

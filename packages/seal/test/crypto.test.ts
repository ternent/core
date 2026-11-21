import { describe, expect, it } from "vite-plus/test";
import { parseIdentity } from "@ternent/identity";
import {
  createSealIdentity,
  createSealMnemonicIdentity,
  exportIdentityJson,
} from "../src/index.js";

describe("seal crypto", () => {
  it("creates and serializes a seal identity", async () => {
    const identity = await createSealIdentity("2026-03-17T00:00:00.000Z");
    const exported = exportIdentityJson(identity);

    expect(identity.format).toBe("ternent-identity");
    expect(identity.version).toBe("2");
    expect(parseIdentity(exported)).toEqual(identity);
  });

  it("creates a mnemonic-backed seal identity", async () => {
    const created = await createSealMnemonicIdentity({ words: 12 });

    expect(created.mnemonic.split(/\s+/).length).toBe(12);
    expect(created.identity.format).toBe("ternent-identity");
  });
});

it("rejects serialized signers whose seed does not match the claimed public key", async () => {
  const { resolveSealSigner } = await import("../src/crypto.js");
  const identity = await createSealIdentity();
  const other = await createSealIdentity();
  const mismatched = { ...identity, material: { ...identity.material, seed: other.material.seed } };
  await expect(resolveSealSigner({ identity: mismatched })).rejects.toThrow(/publicKey|seed/i);
});

import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { base64urlnopad, bech32, hex } from "@scure/base";
import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import * as api from "../src/index.js";
import {
  createIdentity,
  restoreIdentity,
  createMnemonicIdentity,
  recoverIdentity,
  verify,
  validatePublicIdentity,
} from "../src/index.js";

const saved = JSON.parse(
  readFileSync(new URL("../../../docs/seal/vectors/proof.v2.json", import.meta.url), "utf8"),
);
const mnemonic =
  "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";

test("the public interface contains exactly the six identity operations", () => {
  expect(Object.keys(api).sort()).toEqual([
    "createIdentity",
    "createMnemonicIdentity",
    "recoverIdentity",
    "restoreIdentity",
    "validatePublicIdentity",
    "verify",
  ]);
});

test("create, export, restore and exact-byte signing use one usable identity", async () => {
  const identity = await createIdentity();
  expect(Object.keys(identity).sort()).toEqual([
    "export",
    "publicIdentity",
    "sign",
    "withX25519Secret",
  ]);
  expect(Object.isFrozen(identity)).toBe(true);
  expect(Object.isFrozen(identity.publicIdentity)).toBe(true);
  const backup = identity.export();
  const restored = await restoreIdentity(backup);
  expect(restored.publicIdentity).toEqual(identity.publicIdentity);
  expect(JSON.parse(restored.export())).toEqual(JSON.parse(backup));
  const bytes = new TextEncoder().encode("exact bytes");
  const signature = await identity.sign(bytes);
  expect(signature).toHaveLength(64);
  expect(await verify(identity.publicIdentity, bytes, signature)).toBe(true);
  expect(await verify(restored.publicIdentity, bytes, await restored.sign(bytes))).toBe(true);
  expect(await verify(identity.publicIdentity, new Uint8Array([1]), signature)).toBe(false);
  expect(await verify((await createIdentity()).publicIdentity, bytes, signature)).toBe(false);
});

test("existing version 2 backups preserve keys, metadata, signatures and age derivation", async () => {
  const identity = await restoreIdentity(JSON.stringify(saved.identity));
  expect(JSON.parse(identity.export())).toEqual(saved.identity);
  expect(identity.publicIdentity).toEqual({
    version: 1,
    algorithm: "Ed25519",
    publicKey: saved.identity.publicKey,
    id: `identity:${saved.identity.keyId}`,
  });
  expect(hex.encode(await identity.sign(new Uint8Array()))).toBe(
    "e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b",
  );
  expect(
    await verify(
      identity.publicIdentity,
      hex.decode(saved.messageHex),
      base64urlnopad.decode(saved.proof.signature),
    ),
  ).toBe(true);
  await identity.withX25519Secret((secret) => {
    expect(hex.encode(secret)).toBe(
      "307c83864f2833cb427a2ef1c00a013cfdff2768d980c0a3a520f006904de94f",
    );
    expect(bech32.encode("age", bech32.toWords(x25519.getPublicKey(secret)))).toBe(
      "age1mp0q0mpzkzkcs9fhct6y6e3drg2re7psc4av5sc9mpw84y8kkchq6r9kjp",
    );
  });
  expect(
    ed25519.utils.toMontgomery(base64urlnopad.decode(identity.publicIdentity.publicKey)),
  ).toEqual(hex.decode("d85e07ec22b0ad881537c2f44d662d1a143cf830c57aca4305d85c7a90f6b62e"));
});

test("mutable signing input is captured and temporary secrets are cleared on settlement", async () => {
  const identity = await restoreIdentity(JSON.stringify(saved.identity));
  const bytes = new Uint8Array([1, 2, 3]);
  const signature = identity.sign(bytes);
  bytes.fill(0);
  expect(await verify(identity.publicIdentity, new Uint8Array([1, 2, 3]), await signature)).toBe(
    true,
  );
  let borrowed: Uint8Array | undefined;
  await identity.withX25519Secret(async (secret) => {
    borrowed = secret;
    await Promise.resolve();
    expect(secret.some((byte) => byte !== 0)).toBe(true);
  });
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  await expect(
    identity.withX25519Secret((secret) => {
      borrowed = secret;
      throw new Error("callback");
    }),
  ).rejects.toThrow("callback");
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  await expect(
    identity.withX25519Secret(async (secret) => {
      borrowed = secret;
      await Promise.resolve();
      throw new Error("async callback");
    }),
  ).rejects.toThrow("async callback");
  expect(borrowed?.every((byte) => byte === 0)).toBe(true);
  const next = await identity.sign(new Uint8Array());
  expect(await verify(identity.publicIdentity, new Uint8Array(), next)).toBe(true);
});

test("restore rejects malformed and mismatched backup fields", async () => {
  const other = JSON.parse((await createIdentity()).export());
  const invalid = [
    null,
    {},
    { ...saved.identity, version: "1" },
    { ...saved.identity, algorithm: "other" },
    { ...saved.identity, createdAt: 42 },
    { ...saved.identity, publicKey: other.publicKey },
    { ...saved.identity, keyId: other.keyId },
    { ...saved.identity, material: { kind: "seed", seed: other.material.seed } },
  ];
  for (const input of invalid)
    await expect(restoreIdentity(JSON.stringify(input))).rejects.toThrow();
  for (const seed of [
    "",
    saved.identity.material.seed + "!",
    saved.identity.material.seed + "=",
    " " + saved.identity.material.seed,
    base64urlnopad.encode(new Uint8Array(31)),
  ]) {
    await expect(
      restoreIdentity(JSON.stringify({ ...saved.identity, material: { kind: "seed", seed } })),
    ).rejects.toThrow();
  }
  await expect(restoreIdentity("not json")).rejects.toThrow();
});

test("mnemonic recovery retains the selected derivation path and fixed public keys", async () => {
  const cases = [
    [
      mnemonic,
      "TREZOR",
      "6IBjlSqvqPfmXohZXC-oqbjX71wHutV9vvrRtw5VrUE",
      "f34b06f6ffee32599d0e3f49bbee43baf4018ab07378b505da8c778f766096b8",
      "u7XruZ6e2gC5owNbLcZEqRFbgD8GPrqjyn-l5-SIz64",
    ],
    [
      "liberty bag shell level tip galaxy glow shrimp cram hood lawsuit error waste zoo wash rough cinnamon firm sister mistake awful seven nurse hawk",
      "",
      "E71yH7ReOw9yPR0rACZpa_ZU1D8xotD0uYhv5-bDih0",
      "41db29a5d32f112d1cec0511120309e9e02e7f15efda8a1890d269060e120839",
      "GXKurndvf5UYhth7C_uuVjUf84V_17xe0kpIyVS12WI",
    ],
    [
      "legal winner thank year wave sausage worth useful legal winner thank yellow",
      "",
      "8gb5_L0cJPiga567IOtUgTydVa_2361Al17RE0v6sfA",
      "9bcf8f0f872020e588995f39b82e3ceb454e415f7edef4ecf7a5007dc50f8824",
      "9OLA_8sUT8OZ0ILgUUzjI3Bq_uBKGa9Z5fmAPhf1RmE",
    ],
  ];
  for (const [words, passphrase, publicKey, keyId, seed] of cases) {
    const identity = await recoverIdentity(words, passphrase);
    expect(identity.publicIdentity).toEqual({
      version: 1,
      algorithm: "Ed25519",
      publicKey,
      id: `identity:${keyId}`,
    });
    expect(JSON.parse(identity.export()).material.seed).toBe(seed);
  }
  expect((await recoverIdentity(mnemonic, "different")).publicIdentity).not.toEqual(
    (await recoverIdentity(mnemonic, "TREZOR")).publicIdentity,
  );
});

test("mnemonic creation defaults to 12 words, supports 24 and exports no recovery phrase", async () => {
  for (const words of [undefined, 24] as const) {
    const created = await createMnemonicIdentity({ words, passphrase: "optional" });
    expect(created.mnemonic.split(" ")).toHaveLength(words ?? 12);
    expect((await recoverIdentity(created.mnemonic, "optional")).publicIdentity).toEqual(
      created.identity.publicIdentity,
    );
    const backup = JSON.parse(created.identity.export());
    expect(backup.mnemonic).toBeUndefined();
    expect(backup.passphrase).toBeUndefined();
  }
  await expect(recoverIdentity("not recovery words")).rejects.toThrow();
  await expect(createMnemonicIdentity({ words: 18 as 12 })).rejects.toThrow();
});

test("validation returns a detached frozen public identity and verification rejects malformed input", async () => {
  const identity = await createIdentity();
  const input = { ...identity.publicIdentity };
  const validated = validatePublicIdentity(input);
  input.publicKey = "changed";
  expect(validated).toEqual(identity.publicIdentity);
  expect(Object.isFrozen(validated)).toBe(true);
  for (const publicIdentity of [null, {}, { ...identity.publicIdentity, id: "wrong" }]) {
    expect(() => validatePublicIdentity(publicIdentity)).toThrow();
    expect(await verify(publicIdentity as never, new Uint8Array(), new Uint8Array(64))).toBe(false);
  }
  expect(await verify(identity.publicIdentity, new Uint8Array(), new Uint8Array(63))).toBe(false);
  await expect(identity.sign("not bytes" as never)).rejects.toThrow();
});

import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { base64urlnopad } from "@scure/base";
import { createIdentity, restoreIdentity } from "@ternent/identity";
import { Encrypter } from "age-encryption";
import * as api from "../src/index.js";
import { decrypt, encrypt } from "../src/index.js";

const vectors = JSON.parse(readFileSync(new URL("vectors.json", import.meta.url), "utf8"));
const utf8 = (text: string) => new TextEncoder().encode(text);
const owner = () => restoreIdentity(JSON.stringify(vectors.owner));
const { recipient: groupRecipient, secretKey: groupSecretKey } = vectors.group;

test("the public interface is encrypt and decrypt", () => {
  expect(Object.keys(api).sort()).toEqual(["decrypt", "encrypt"]);
});

test("saved native-age ciphertext decrypts with the owner identity and the group key", async () => {
  const opened = async (ciphertext: string, key: Parameters<typeof decrypt>[1]) =>
    JSON.parse(new TextDecoder().decode(await decrypt(base64urlnopad.decode(ciphertext), key)));
  const { toOwner, toGroup } = vectors;
  expect(await opened(toOwner.ciphertext, await owner())).toEqual(JSON.parse(toOwner.plaintext));
  expect(await opened(toGroup.ciphertext, groupSecretKey)).toEqual(JSON.parse(toGroup.plaintext));
});

test("one call encrypts to several identities and a group, with fresh randomness", async () => {
  const alice = await createIdentity();
  const bob = await createIdentity();
  const outsider = await createIdentity();
  const plaintext = utf8("shared");
  const targets = [alice.publicIdentity, bob.publicIdentity, groupRecipient];
  const ciphertext = await encrypt(plaintext, targets);
  expect(ciphertext).not.toEqual(await encrypt(plaintext, targets));
  expect(new TextDecoder().decode(ciphertext.subarray(0, 21))).toBe("age-encryption.org/v1");
  for (const key of [alice, bob, groupSecretKey]) {
    expect(await decrypt(ciphertext, key)).toEqual(plaintext);
  }
  await expect(decrypt(ciphertext, outsider)).rejects.toThrow();
});

test("empty plaintext is valid", async () => {
  const identity = await createIdentity();
  const ciphertext = await encrypt(new Uint8Array(), [identity.publicIdentity]);
  expect(await decrypt(ciphertext, identity)).toEqual(new Uint8Array());
});

test("passphrase encryption round-trips an Identity backup with the exact passphrase", async () => {
  const identity = await createIdentity();
  const backup = utf8(identity.export());
  const passphrase = " correct horse ";
  const ciphertext = await encrypt(backup, { passphrase });
  const restored = await restoreIdentity(
    new TextDecoder().decode(await decrypt(ciphertext, { passphrase })),
  );
  expect(restored.publicIdentity).toEqual(identity.publicIdentity);
  await expect(decrypt(ciphertext, { passphrase: "correct horse" })).rejects.toThrow();
  await expect(decrypt(ciphertext, identity)).rejects.toThrow();
});

test("passphrase decryption rejects a scrypt work factor above 20 before deriving a key", async () => {
  // age refuses to encrypt at logN 21, so raise the factor in a cheap file's header.
  const encrypter = new Encrypter();
  encrypter.setPassphrase("secret");
  encrypter.setScryptWorkFactor(10);
  const file = String.fromCharCode(...(await encrypter.encrypt(utf8("x"))));
  const edited = file.replace(/(-> scrypt \S+) 10\n/, "$1 21\n");
  expect(edited).not.toBe(file);
  const raised = Uint8Array.from(edited, (char) => char.charCodeAt(0));
  const started = performance.now();
  await expect(decrypt(raised, { passphrase: "secret" })).rejects.toThrow(/work factor|logN/i);
  expect(performance.now() - started).toBeLessThan(500);
});

test("tampered ciphertext releases no plaintext", async () => {
  const identity = await createIdentity();
  const ciphertext = await encrypt(utf8("authentic"), [identity.publicIdentity]);
  for (const index of [30, ciphertext.length - 1]) {
    const tampered = ciphertext.slice();
    tampered[index] ^= 1;
    await expect(decrypt(tampered, identity)).rejects.toThrow();
  }
});

test("invalid inputs reject", async () => {
  const identity = await createIdentity();
  const ciphertext = await encrypt(utf8("x"), [groupRecipient]);
  const badBinding = { ...identity.publicIdentity, id: (await createIdentity()).publicIdentity.id };
  for (const target of [
    [],
    [badBinding],
    ["age1notarecipient"],
    [groupSecretKey],
    { passphrase: "" },
    { passphrase: 1 },
    "age1" as never,
  ]) {
    await expect(encrypt(utf8("x"), target as never)).rejects.toThrow();
  }
  await expect(encrypt("text" as never, [groupRecipient])).rejects.toThrow();
  for (const key of [groupRecipient, groupSecretKey.toLowerCase(), { passphrase: "" }, {}, null]) {
    await expect(decrypt(ciphertext, key as never)).rejects.toThrow();
  }
});

test("inputs are captured at call time", async () => {
  const identity = await createIdentity();
  const plaintext = utf8("original");
  const targets = [{ ...identity.publicIdentity }];
  const pending = encrypt(plaintext, targets);
  plaintext.fill(0);
  targets[0].publicKey = "changed";
  const ciphertext = await pending;
  const decrypting = decrypt(ciphertext, identity);
  ciphertext.fill(0);
  expect(await decrypting).toEqual(utf8("original"));
});

test("the native age CLI and Armour read each other's ciphertext", async () => {
  const dir = mkdtempSync(join(tmpdir(), "armour-age-"));
  try {
    const keyFile = join(dir, "key.txt");
    writeFileSync(keyFile, `${groupSecretKey}\n`, { mode: 0o600 });
    const plaintext = utf8("interop");
    const ours = await encrypt(plaintext, [groupRecipient]);
    expect(
      new Uint8Array(execFileSync("age", ["--decrypt", "-i", keyFile], { input: ours })),
    ).toEqual(plaintext);
    const native = execFileSync("age", ["--encrypt", "-r", groupRecipient], { input: plaintext });
    expect(await decrypt(new Uint8Array(native), groupSecretKey)).toEqual(plaintext);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

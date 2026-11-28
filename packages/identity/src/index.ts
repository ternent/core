import { ed25519 } from "@noble/curves/ed25519.js";
import { hmac } from "@noble/hashes/hmac.js";
import { sha256, sha512 } from "@noble/hashes/sha2.js";
import { concatBytes } from "@noble/hashes/utils.js";
import { base64urlnopad, hex } from "@scure/base";
import { generateMnemonic, mnemonicToSeed, validateMnemonic } from "@scure/bip39";
import { wordlist } from "@scure/bip39/wordlists/english.js";

export type PublicIdentity = Readonly<{
  version: 1;
  algorithm: "Ed25519";
  publicKey: string;
  id: string;
}>;

export interface Identity {
  readonly publicIdentity: PublicIdentity;
  export(): string;
  sign(bytes: Uint8Array): Promise<Uint8Array>;
  withX25519Secret<T>(use: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
}

// SLIP-0010 hardened path m/101010'/25519'/0'.
const DERIVATION_PATH = [101010, 25519, 0];

export async function createIdentity(): Promise<Identity> {
  return fromSeed(ed25519.utils.randomSecretKey(), new Date().toISOString());
}

export async function restoreIdentity(backup: string): Promise<Identity> {
  const { format, version, algorithm, createdAt, publicKey, keyId, material } = JSON.parse(backup);
  if (
    format !== "ternent-identity" ||
    version !== "2" ||
    algorithm !== "Ed25519" ||
    typeof createdAt !== "string" ||
    material?.kind !== "seed"
  ) {
    throw new Error("Not a ternent-identity version 2 backup");
  }
  const identity = fromSeed(base64urlnopad.decode(material.seed), createdAt);
  if (
    publicKey !== identity.publicIdentity.publicKey ||
    `identity:${keyId}` !== identity.publicIdentity.id
  ) {
    throw new Error("Backup public key does not match its seed");
  }
  return identity;
}

export async function createMnemonicIdentity({
  words = 12,
  passphrase = "",
}: { words?: 12 | 24; passphrase?: string } = {}): Promise<{
  identity: Identity;
  mnemonic: string;
}> {
  if (words !== 12 && words !== 24) throw new RangeError("Recovery phrases have 12 or 24 words");
  const mnemonic = generateMnemonic(wordlist, words === 24 ? 256 : 128);
  return { identity: await recoverIdentity(mnemonic, passphrase), mnemonic };
}

export async function recoverIdentity(mnemonic: string, passphrase = ""): Promise<Identity> {
  if (!validateMnemonic(mnemonic, wordlist)) throw new Error("Invalid recovery phrase");
  let node = hmac(
    sha512,
    new TextEncoder().encode("ed25519 seed"),
    await mnemonicToSeed(mnemonic, passphrase),
  );
  for (const index of DERIVATION_PATH) {
    const hardened = new Uint8Array(4);
    new DataView(hardened.buffer).setUint32(0, index + 0x80000000);
    node = hmac(
      sha512,
      node.subarray(32),
      concatBytes(new Uint8Array(1), node.subarray(0, 32), hardened),
    );
  }
  return fromSeed(node.slice(0, 32), new Date().toISOString());
}

export async function verify(
  publicIdentity: PublicIdentity,
  bytes: Uint8Array,
  signature: Uint8Array,
): Promise<boolean> {
  try {
    const publicKey = base64urlnopad.decode(validatePublicIdentity(publicIdentity).publicKey);
    // Noble's strict mode rejects non-canonical encodings, S >= L and a small-order key;
    // the R check keeps a signature from carrying a small-order or torsion component.
    return (
      isPrimeOrderPoint(signature.subarray(0, 32)) &&
      ed25519.verify(signature, bytes, publicKey, { zip215: false })
    );
  } catch {
    return false;
  }
}

export function validatePublicIdentity(input: unknown): PublicIdentity {
  if (typeof input !== "object" || input === null || Object.keys(input).length !== 4) {
    throw new TypeError("Invalid public identity");
  }
  const { version, algorithm, publicKey, id } = input as Record<string, unknown>;
  if (version !== 1 || algorithm !== "Ed25519" || typeof publicKey !== "string") {
    throw new TypeError("Invalid public identity");
  }
  const key = base64urlnopad.decode(publicKey);
  if (!isPrimeOrderPoint(key) || id !== identityId(key)) {
    throw new TypeError("Invalid public identity");
  }
  return Object.freeze({ version, algorithm, publicKey, id });
}

function fromSeed(seed: Uint8Array, createdAt: string): Identity {
  const key = ed25519.getPublicKey(seed);
  const publicIdentity: PublicIdentity = Object.freeze({
    version: 1,
    algorithm: "Ed25519",
    publicKey: base64urlnopad.encode(key),
    id: identityId(key),
  });
  return Object.freeze({
    publicIdentity,
    export: () =>
      JSON.stringify(
        {
          format: "ternent-identity",
          version: "2",
          algorithm: "Ed25519",
          createdAt,
          publicKey: publicIdentity.publicKey,
          keyId: publicIdentity.id.slice("identity:".length),
          material: { kind: "seed", seed: base64urlnopad.encode(seed) },
        },
        null,
        2,
      ),
    // Signing runs before the first await, so later changes to `bytes` cannot alter it.
    sign: async (bytes: Uint8Array) => ed25519.sign(bytes, seed),
    async withX25519Secret<T>(use: (secret: Uint8Array) => T | Promise<T>): Promise<T> {
      const secret = ed25519.utils.toMontgomerySecret(seed);
      try {
        return await use(secret);
      } finally {
        secret.fill(0);
      }
    },
  });
}

function identityId(publicKey: Uint8Array): string {
  return `identity:${hex.encode(sha256(publicKey))}`;
}

function isPrimeOrderPoint(bytes: Uint8Array): boolean {
  const point = ed25519.Point.fromBytes(bytes);
  return !point.isSmallOrder() && point.isTorsionFree();
}

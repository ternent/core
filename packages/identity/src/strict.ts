import { ed25519, x25519 } from "@noble/curves/ed25519.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base64urlnopad, bech32, hex } from "@scure/base";

export type PrimitiveError = { code: string; message: string };
export type PrimitiveResult<T> = { ok: true; value: T } | { ok: false; error: PrimitiveError };
export type PublicIdentity = Readonly<{
  version: 1;
  algorithm: "Ed25519";
  publicKey: string;
  id: string;
}>;
export type BaseIdentityCapability = {
  readonly publicIdentity: PublicIdentity;
  sign(this: void, message: Uint8Array): Promise<PrimitiveResult<Uint8Array>>;
  withX25519Secret<T>(this: void, callback: (secret: Uint8Array) => T | Promise<T>): Promise<T>;
};

const failure = (code: string): PrimitiveResult<never> => ({
  ok: false,
  error: { code, message: code.replaceAll("_", " ").toLowerCase() },
});

export function encodeBase64Url(bytes: Uint8Array): string {
  return base64urlnopad.encode(bytes);
}
export function decodeBase64Url(value: string): PrimitiveResult<Uint8Array> {
  try {
    if (typeof value !== "string" || !/^[A-Za-z0-9_-]*$/.test(value))
      return failure("ENCODING_INVALID");
    const bytes = base64urlnopad.decode(value);
    return encodeBase64Url(bytes) === value
      ? { ok: true, value: bytes }
      : failure("ENCODING_INVALID");
  } catch {
    return failure("ENCODING_INVALID");
  }
}

function strictPoint(bytes: Uint8Array): boolean {
  try {
    if (bytes.length !== 32) return false;
    const point = ed25519.Point.fromBytes(bytes, false);
    return (
      !point.isSmallOrder() &&
      point.isTorsionFree() &&
      hex.encode(point.toBytes()) === hex.encode(bytes)
    );
  } catch {
    return false;
  }
}

export function validatePublicIdentity(input: unknown): PrimitiveResult<PublicIdentity> {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input))
      return failure("IDENTITY_INVALID");
    const descriptors = Object.getOwnPropertyDescriptors(input);
    if (
      Reflect.ownKeys(input).length !== 4 ||
      !["version", "algorithm", "publicKey", "id"].every(
        (key) => descriptors[key] && "value" in descriptors[key],
      )
    )
      return failure("IDENTITY_INVALID");
    const identity = input as PublicIdentity;
    if (identity.version !== 1 || identity.algorithm !== "Ed25519")
      return failure("IDENTITY_INVALID");
    const decoded = decodeBase64Url(identity.publicKey);
    if (
      !decoded.ok ||
      !strictPoint(decoded.value) ||
      identity.id !== `identity:${hex.encode(sha256(decoded.value))}`
    )
      return failure("IDENTITY_INVALID");
    return {
      ok: true,
      value: Object.freeze({
        version: 1,
        algorithm: "Ed25519",
        publicKey: identity.publicKey,
        id: identity.id,
      }),
    };
  } catch {
    return failure("IDENTITY_INVALID");
  }
}

export async function verifySignature(
  identity: PublicIdentity,
  message: Uint8Array,
  signature: Uint8Array,
): Promise<PrimitiveResult<boolean>> {
  const valid = validatePublicIdentity(identity);
  if (!valid.ok) return valid;
  try {
    if (
      !(message instanceof Uint8Array) ||
      !(signature instanceof Uint8Array) ||
      signature.length !== 64 ||
      !strictPoint(signature.subarray(0, 32))
    )
      return failure("SIGNATURE_INVALID");
    let scalar = 0n;
    for (let i = 63; i >= 32; i--) scalar = (scalar << 8n) | BigInt(signature[i]);
    if (scalar >= ed25519.Point.CURVE().n) return failure("SIGNATURE_INVALID");
    const key = decodeBase64Url(valid.value.publicKey);
    if (!key.ok) return key;
    return ed25519.verify(signature, message, key.value, { zip215: false })
      ? { ok: true, value: true }
      : failure("SIGNATURE_INVALID");
  } catch {
    return failure("SIGNATURE_INVALID");
  }
}

export function ageSecretKey(secret: Uint8Array): string {
  if (secret.length !== 32) throw new TypeError("An X25519 scalar is 32 bytes");
  return bech32.encode("age-secret-key-", bech32.toWords(secret)).toUpperCase();
}
export function validateAgeRecipient(recipient: string): PrimitiveResult<string> {
  try {
    const decoded = bech32.decode(recipient as `${string}1${string}`);
    if (
      decoded.prefix !== "age" ||
      bech32.fromWords(decoded.words).length !== 32 ||
      bech32.encode("age", decoded.words) !== recipient
    )
      return failure("RECIPIENT_INVALID");
    return { ok: true, value: recipient };
  } catch {
    return failure("RECIPIENT_INVALID");
  }
}
export function ageRecipientFromSecret(secret: Uint8Array): string {
  if (secret.length !== 32) throw new TypeError("An X25519 scalar is 32 bytes");
  return bech32.encode("age", bech32.toWords(x25519.getPublicKey(secret)));
}
export function ageRecipientFromPublicIdentity(identity: PublicIdentity): PrimitiveResult<string> {
  const valid = validatePublicIdentity(identity);
  if (!valid.ok) return valid;
  const decoded = decodeBase64Url(valid.value.publicKey);
  if (!decoded.ok) return decoded;
  return {
    ok: true,
    value: bech32.encode("age", bech32.toWords(ed25519.utils.toMontgomery(decoded.value))),
  };
}

export async function signerFromSeed(
  input: Uint8Array,
): Promise<PrimitiveResult<BaseIdentityCapability>> {
  if (!(input instanceof Uint8Array) || input.length !== 32) return failure("SEED_INVALID");
  const seed = new Uint8Array(input);
  const key = ed25519.getPublicKey(seed);
  const publicIdentity: PublicIdentity = Object.freeze({
    version: 1,
    algorithm: "Ed25519",
    publicKey: encodeBase64Url(key),
    id: `identity:${hex.encode(sha256(key))}`,
  });
  return {
    ok: true,
    value: Object.freeze({
      publicIdentity,
      async sign(message: Uint8Array) {
        try {
          if (!(message instanceof Uint8Array)) return failure("SIGNING_FAILED");
          return { ok: true as const, value: ed25519.sign(new Uint8Array(message), seed) };
        } catch {
          return failure("SIGNING_FAILED");
        }
      },
      async withX25519Secret<T>(
        this: void,
        callback: (secret: Uint8Array) => T | Promise<T>,
      ): Promise<T> {
        const secret = ed25519.utils.toMontgomerySecret(seed);
        try {
          return await callback(secret);
        } finally {
          secret.fill(0);
        }
      },
    }),
  };
}
export async function generateSigner(): Promise<PrimitiveResult<BaseIdentityCapability>> {
  try {
    const seed = ed25519.utils.randomSecretKey();
    try {
      return await signerFromSeed(seed);
    } finally {
      seed.fill(0);
    }
  } catch {
    return failure("GENERATION_FAILED");
  }
}

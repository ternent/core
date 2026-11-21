import {
  createIdentity,
  createIdentityFromMnemonic,
  createMnemonicIdentity,
  deriveKeyId,
  validateIdentity,
  validatePublicIdentity,
  decodeBase64Url,
  verifySignature,
  serializeIdentity,
  signUtf8,
  type SerializedIdentity,
} from "@ternent/identity";

export type SealSignerInput = {
  identity: SerializedIdentity;
};

export type ResolvedSealSigner = {
  identity: SerializedIdentity;
  publicKey: string;
  keyId: string;
};

export const SEAL_SIGNATURE_CONTEXT = "ternent-seal/v2";

export async function createSealIdentity(
  createdAt = new Date().toISOString(),
): Promise<SerializedIdentity> {
  return createIdentity(createdAt);
}

export async function createSealIdentityFromMnemonic(input: {
  mnemonic: string;
  passphrase?: string;
  createdAt?: string;
}): Promise<SerializedIdentity> {
  return createIdentityFromMnemonic(input);
}

export async function createSealMnemonicIdentity(
  input: {
    words?: 12 | 24;
    passphrase?: string;
    createdAt?: string;
  } = {},
): Promise<{ identity: SerializedIdentity; mnemonic: string }> {
  return createMnemonicIdentity(input);
}

export function exportIdentityJson(identity: SerializedIdentity): string {
  return serializeIdentity(identity);
}

export async function resolveSealSigner(input: SealSignerInput): Promise<ResolvedSealSigner> {
  const identity = await validateIdentity(input.identity);
  const keyId = await deriveKeyId(identity.publicKey);
  if (keyId !== identity.keyId || !(await verifyPublicKeyKeyId(identity.publicKey, keyId))) {
    throw new Error("Identity keyId does not match the signer public key.");
  }

  return {
    identity,
    publicKey: identity.publicKey,
    keyId,
  };
}

export async function signSealUtf8(identity: SerializedIdentity, value: string): Promise<string> {
  return signUtf8(identity, value, {
    context: SEAL_SIGNATURE_CONTEXT,
  });
}

export async function verifySealUtf8(
  signature: string,
  value: string,
  publicKey: string,
): Promise<boolean> {
  try {
    const keyId = await deriveKeyId(publicKey);
    const identity = {
      version: 1 as const,
      algorithm: "Ed25519" as const,
      publicKey,
      id: `identity:${keyId}`,
    };
    const decoded = decodeBase64Url(signature);
    if (!decoded.ok) return false;
    const result = await verifySignature(
      identity,
      new TextEncoder().encode(`${SEAL_SIGNATURE_CONTEXT}\0${value}`),
      decoded.value,
    );
    return result.ok && result.value;
  } catch {
    return false;
  }
}

export async function verifyPublicKeyKeyId(publicKey: string, keyId: string): Promise<boolean> {
  try {
    return validatePublicIdentity({
      version: 1,
      algorithm: "Ed25519",
      publicKey,
      id: `identity:${keyId}`,
    }).ok;
  } catch {
    return false;
  }
}

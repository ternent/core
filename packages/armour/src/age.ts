import { Encrypter, Decrypter } from "age-encryption";
import {
  ageSecretKey,
  generateSigner,
  signerFromSeed,
  type BaseIdentityCapability,
  type PrimitiveResult,
  type PublicIdentity,
} from "@ternent/identity";

export type ReaderCapability = {
  readonly publicIdentity: PublicIdentity;
  decryptAge(this: void, ciphertext: Uint8Array): Promise<PrimitiveResult<Uint8Array>>;
};
export type IdentityCapability = ReaderCapability & Pick<BaseIdentityCapability, "sign">;
const failed = (code: string): PrimitiveResult<never> => ({
  ok: false,
  error: { code, message: code.replaceAll("_", " ").toLowerCase() },
});

export async function encryptAge(input: {
  recipients: readonly string[];
  plaintext: Uint8Array;
}): Promise<PrimitiveResult<Uint8Array>> {
  try {
    if (
      !Array.isArray(input.recipients) ||
      !input.recipients.length ||
      !(input.plaintext instanceof Uint8Array)
    )
      return failed("ENCRYPTION_INVALID");
    const encrypter = new Encrypter();
    for (const recipient of input.recipients) {
      if (!/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/.test(recipient))
        return failed("RECIPIENT_INVALID");
      encrypter.addRecipient(recipient);
    }
    return { ok: true, value: await encrypter.encrypt(new Uint8Array(input.plaintext)) };
  } catch {
    return failed("ENCRYPTION_FAILED");
  }
}
export async function decryptAgeWithSecret(input: {
  secret: Uint8Array;
  ciphertext: Uint8Array;
}): Promise<PrimitiveResult<Uint8Array>> {
  try {
    const decrypter = new Decrypter();
    decrypter.addIdentity(ageSecretKey(input.secret));
    return { ok: true, value: await decrypter.decrypt(new Uint8Array(input.ciphertext)) };
  } catch {
    return failed("DECRYPTION_FAILED");
  }
}
export function withAgeDecryption(base: BaseIdentityCapability): IdentityCapability {
  return Object.freeze({
    publicIdentity: base.publicIdentity,
    sign: (message: Uint8Array) => base.sign(new Uint8Array(message)),
    decryptAge: (ciphertext: Uint8Array) => {
      const bytes = new Uint8Array(ciphertext);
      return base.withX25519Secret((secret) => decryptAgeWithSecret({ secret, ciphertext: bytes }));
    },
  });
}
export async function identityFromSeed(
  seed: Uint8Array,
): Promise<PrimitiveResult<IdentityCapability>> {
  const base = await signerFromSeed(seed);
  return base.ok ? { ok: true, value: withAgeDecryption(base.value) } : base;
}
export async function generateIdentity(): Promise<PrimitiveResult<IdentityCapability>> {
  const base = await generateSigner();
  return base.ok ? { ok: true, value: withAgeDecryption(base.value) } : base;
}

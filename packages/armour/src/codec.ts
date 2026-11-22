import { validateAgeRecipient } from "@ternent/identity";
import { encryptAge, type ReaderCapability } from "./age.js";
import { ArmourDecryptionError, ArmourEncryptionError, ArmourValidationError } from "./errors.js";

/** Compatible with Ledger's optional payload helpers, without a dependency on Ledger. */
export type AgePayloadCodec = {
  readonly id: "age";
  encode?(this: void, plaintext: Uint8Array): Promise<Uint8Array>;
  decode?(this: void, ciphertext: Uint8Array): Promise<Uint8Array | null>;
};
export type AgePayloadEncoder = AgePayloadCodec & Required<Pick<AgePayloadCodec, "encode">>;
export type AgePayloadDecoder = AgePayloadCodec & Required<Pick<AgePayloadCodec, "decode">>;
type AgeCodecOptions = {
  recipients?: readonly string[];
  reader?: Pick<ReaderCapability, "decryptAge">;
};
export function createAgeCodec(
  input: Required<AgeCodecOptions>,
): AgePayloadEncoder & AgePayloadDecoder;
export function createAgeCodec(
  input: AgeCodecOptions & { recipients: readonly string[] },
): AgePayloadEncoder;
export function createAgeCodec(
  input: AgeCodecOptions & { reader: Pick<ReaderCapability, "decryptAge"> },
): AgePayloadDecoder;
export function createAgeCodec(input?: AgeCodecOptions): AgePayloadCodec;
export function createAgeCodec(input: AgeCodecOptions = {}): AgePayloadCodec {
  if (
    !input ||
    typeof input !== "object" ||
    Array.isArray(input) ||
    Object.keys(input).some((key) => key !== "recipients" && key !== "reader")
  )
    throw new ArmourValidationError("ARMOUR_INVALID_RECIPIENT", "Invalid codec configuration.");
  const recipients = input.recipients;
  if (
    recipients !== undefined &&
    (!Array.isArray(recipients) ||
      !recipients.length ||
      recipients.some((recipient) => !validateAgeRecipient(recipient).ok))
  )
    throw new ArmourValidationError(
      "ARMOUR_INVALID_RECIPIENT",
      "Expected nonempty age recipients.",
    );
  const targets = recipients && [...recipients];
  const decrypt = input.reader?.decryptAge;
  if (input.reader !== undefined && typeof decrypt !== "function")
    throw new ArmourValidationError("ARMOUR_INVALID_IDENTITY", "Expected a decryption capability.");
  return Object.freeze({
    id: "age",
    ...(targets
      ? {
          encode: async (plaintext: Uint8Array) => {
            const result = await encryptAge({ recipients: targets, plaintext });
            if (!result.ok)
              throw new ArmourEncryptionError(
                "ARMOUR_ENCRYPT_FAILED",
                "Failed to encrypt payload.",
              );
            return result.value;
          },
        }
      : {}),
    ...(decrypt
      ? {
          decode: async (ciphertext: Uint8Array) => {
            const result = await decrypt(new Uint8Array(ciphertext));
            if (result.ok) return result.value;
            if (result.error.code === "DECRYPTION_FAILED") return null;
            throw new ArmourDecryptionError(
              "ARMOUR_DECRYPT_FAILED",
              "Reader could not process the payload.",
              result.error,
            );
          },
        }
      : {}),
  });
}

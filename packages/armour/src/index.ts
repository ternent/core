export {
  ArmourDecryptionError,
  ArmourEncryptionError,
  ArmourError,
  ArmourIdentityError,
  ArmourValidationError,
} from "./errors.js";
export {
  decryptBinaryWithIdentity,
  decryptBinaryWithPassphrase,
  encryptBinaryForIdentities,
  encryptBinaryWithPassphrase,
} from "./files.js";
export { recipientFromIdentity, resolveIdentity, secretKeyFromIdentity } from "./identity.js";
export { decryptWithPassphrase, encryptWithPassphrase } from "./passphrase.js";
export {
  decryptWithIdentity,
  decryptWithSecretKey,
  encryptForIdentities,
  encryptForRecipients,
  recipientsFromIdentities,
} from "./recipients.js";
export {
  decryptTextWithIdentity,
  decryptTextWithPassphrase,
  encryptTextForIdentities,
  encryptTextWithPassphrase,
} from "./text.js";
export type { SerializedIdentity } from "@ternent/identity";
export type {
  ArmourBinaryInput,
  ArmourErrorCode,
  ArmourIdentityInput,
  ArmourOutputFormat,
  DecryptBinaryWithIdentityInput,
  DecryptBinaryWithPassphraseInput,
  DecryptTextWithIdentityInput,
  DecryptTextWithPassphraseInput,
  DecryptWithIdentityInput,
  DecryptWithPassphraseInput,
  DecryptWithSecretKeyInput,
  EncryptBinaryForIdentitiesInput,
  EncryptBinaryWithPassphraseInput,
  EncryptForIdentitiesInput,
  EncryptForRecipientsInput,
  EncryptTextForIdentitiesInput,
  EncryptTextWithPassphraseInput,
  EncryptWithPassphraseInput,
} from "./types.js";
export {
  encryptAge,
  decryptAgeWithSecret,
  withAgeDecryption,
  identityFromSeed,
  generateIdentity,
} from "./age.js";
export type { ReaderCapability, IdentityCapability } from "./age.js";

// Text, file and passphrase operations over the same TypeScript age engine.
import { Encrypter, Decrypter, armor } from "age-encryption";
import type { ArmourOutputFormat } from "./types.js";
export class AgeEngineError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export class AgeEngineValidationError extends AgeEngineError {}
export class AgeEngineEncryptionError extends AgeEngineError {}
export class AgeEngineDecryptionError extends AgeEngineError {}
function dataCheck(data: Uint8Array): void {
  if (!(data instanceof Uint8Array) || !data.length)
    throw new AgeEngineValidationError("AGE_ENGINE_EMPTY_DATA");
  if (data.length > 64 * 1024 * 1024)
    throw new AgeEngineValidationError("AGE_ENGINE_DATA_TOO_LARGE");
}
function output(data: Uint8Array, format?: ArmourOutputFormat): Uint8Array {
  return (format ?? "armor") === "armor" ? new TextEncoder().encode(armor.encode(data)) : data;
}
function binary(data: Uint8Array): Uint8Array {
  return new TextDecoder().decode(data.subarray(0, 35)).startsWith("-----BEGIN AGE")
    ? armor.decode(new TextDecoder().decode(data))
    : data;
}
export async function encryptWithRecipients(input: {
  recipients: string[];
  data: Uint8Array;
  output?: ArmourOutputFormat;
}): Promise<Uint8Array> {
  dataCheck(input.data);
  if (!input.recipients.length) throw new AgeEngineValidationError("AGE_ENGINE_EMPTY_RECIPIENTS");
  const encrypter = new Encrypter();
  try {
    for (const recipient of input.recipients) encrypter.addRecipient(recipient);
  } catch {
    throw new AgeEngineValidationError("AGE_ENGINE_INVALID_RECIPIENT");
  }
  try {
    return output(await encrypter.encrypt(input.data), input.output);
  } catch {
    throw new AgeEngineEncryptionError("AGE_ENGINE_ENCRYPT_FAILED");
  }
}
export async function decryptWithIdentity(input: {
  identity: string;
  data: Uint8Array;
}): Promise<Uint8Array> {
  dataCheck(input.data);
  const decrypter = new Decrypter();
  try {
    decrypter.addIdentity(input.identity);
  } catch {
    throw new AgeEngineValidationError("AGE_ENGINE_INVALID_IDENTITY");
  }
  try {
    return await decrypter.decrypt(binary(input.data));
  } catch {
    throw new AgeEngineDecryptionError("AGE_ENGINE_DECRYPT_FAILED");
  }
}
export async function encryptWithPassphrase(input: {
  passphrase: string;
  data: Uint8Array;
  output?: ArmourOutputFormat;
}): Promise<Uint8Array> {
  dataCheck(input.data);
  if (!input.passphrase) throw new AgeEngineValidationError("AGE_ENGINE_EMPTY_PASSPHRASE");
  const encrypter = new Encrypter();
  encrypter.setPassphrase(input.passphrase);
  return output(await encrypter.encrypt(input.data), input.output);
}
export async function decryptWithPassphrase(input: {
  passphrase: string;
  data: Uint8Array;
}): Promise<Uint8Array> {
  dataCheck(input.data);
  if (!input.passphrase) throw new AgeEngineValidationError("AGE_ENGINE_EMPTY_PASSPHRASE");
  const decrypter = new Decrypter();
  decrypter.addPassphrase(input.passphrase);
  try {
    return await decrypter.decrypt(binary(input.data));
  } catch {
    throw new AgeEngineDecryptionError("AGE_ENGINE_DECRYPT_FAILED");
  }
}

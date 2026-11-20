import {
  ageRecipientFromPublicIdentity,
  ageRecipientFromSecret,
  decodeBase64Url,
  encodeBase64Url,
} from "@ternent/identity";
import { encryptAge, type ReaderCapability } from "@ternent/armour";
import { fail } from "../common/errors.js";
import { encodeJson, parseJson, text } from "../protocol/json.js";
import { object } from "../protocol/schema.js";
import type { EntrySubject, JsonObject, Limits, PublicIdentity } from "../protocol/types.js";

type ContextError = "SYSTEM_EVENT_INVALID" | "KEY_WRAP_INVALID" | "EVENT_CONTEXT_INVALID";
type EntryContext = Pick<EntrySubject, "parent" | "nonce">;

export const equal = (a: unknown, b: unknown) =>
  text.decode(encodeJson(a)) === text.decode(encodeJson(b));

export function fields(
  value: unknown,
  keys: string[],
  code: ContextError,
): asserts value is JsonObject {
  if (
    !object(value) ||
    Object.keys(value).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(value, key))
  )
    fail(code, "system");
}

export function unbase(
  value: unknown,
  lim: Limits,
  code: "KEY_WRAP_INVALID" | "EVENT_CONTEXT_INVALID",
): Uint8Array {
  if (typeof value !== "string" || Math.floor((value.length * 6) / 8) > lim.maxCiphertextBytes)
    fail(code, "system");
  const result = decodeBase64Url(value);
  if (!result.ok || result.value.length === 0) fail(code, "system");
  return result.value;
}

export function plaintext(
  bytes: Uint8Array,
  lim: Limits,
  code: "KEY_WRAP_INVALID" | "EVENT_CONTEXT_INVALID",
): JsonObject {
  try {
    const parsed = parseJson(bytes, lim.maxDepth, lim.maxBytes);
    if (!object(parsed)) fail(code, "system");
    const canonical = encodeJson(parsed, lim.maxDepth);
    if (canonical.length !== bytes.length || !canonical.every((byte, i) => byte === bytes[i]))
      fail(code, "system");
    return parsed as JsonObject;
  } catch {
    fail(code, "system");
  }
}

export function groupSecret(): Uint8Array {
  const secret = crypto.getRandomValues(new Uint8Array(32));
  secret[0] &= 248;
  secret[31] = (secret[31] & 127) | 64;
  return secret;
}

export async function encrypt(recipient: string, body: JsonObject, lim: Limits): Promise<string> {
  const encrypted = await encryptAge({
    recipients: [recipient],
    plaintext: encodeJson(body, lim.maxDepth),
  });
  if (!encrypted.ok) fail("ENCRYPTION_FAILED", "author");
  if (encrypted.value.length > lim.maxCiphertextBytes) fail("RESOURCE_LIMIT");
  return encodeBase64Url(encrypted.value);
}

export function wrapKey(
  context: EntryContext,
  identity: PublicIdentity,
  epoch: number,
  recipient: string,
  secret: Uint8Array,
  lim: Limits,
): Promise<string> {
  const target = ageRecipientFromPublicIdentity(identity);
  if (!target.ok) fail("IDENTITY_MISMATCH", "requirements");
  return encrypt(
    target.value,
    {
      context: "concord.audience-key/1",
      parent: context.parent,
      nonce: context.nonce,
      audience: "document",
      epoch,
      identityId: identity.id,
      recipient,
      secret: encodeBase64Url(secret),
    },
    lim,
  );
}

export async function unwrapKey(
  context: EntryContext,
  reader: ReaderCapability,
  epoch: number,
  recipient: string,
  ciphertext: string,
  lim: Limits,
): Promise<Uint8Array> {
  const decrypted = await reader.decryptAge(unbase(ciphertext, lim, "KEY_WRAP_INVALID"));
  if (!decrypted.ok) fail("KEY_WRAP_INVALID", "system");
  const key = plaintext(decrypted.value, lim, "KEY_WRAP_INVALID");
  fields(
    key,
    ["context", "parent", "nonce", "audience", "epoch", "identityId", "recipient", "secret"],
    "KEY_WRAP_INVALID",
  );
  if (
    key.context !== "concord.audience-key/1" ||
    key.parent !== context.parent ||
    key.nonce !== context.nonce ||
    key.audience !== "document" ||
    key.epoch !== epoch ||
    key.identityId !== reader.publicIdentity.id ||
    key.recipient !== recipient
  )
    fail("KEY_WRAP_INVALID", "system");

  const secret = unbase(key.secret, lim, "KEY_WRAP_INVALID");
  if (
    secret.length !== 32 ||
    (secret[0] & 7) !== 0 ||
    (secret[31] & 192) !== 64 ||
    ageRecipientFromSecret(secret) !== recipient
  ) {
    secret.fill(0);
    fail("KEY_WRAP_INVALID", "system");
  }
  return secret;
}

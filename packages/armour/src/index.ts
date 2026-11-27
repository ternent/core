import { ed25519 } from "@noble/curves/ed25519.js";
import { base64urlnopad, bech32 } from "@scure/base";
import { validatePublicIdentity, type Identity, type PublicIdentity } from "@ternent/identity";
import { Decrypter, Encrypter } from "age-encryption";

export type Passphrase = { passphrase: string };

// age's own parsers also accept hybrid and plugin keys; Armour takes X25519 only.
const X25519_RECIPIENT = /^age1[02-9ac-hj-np-z]{58}$/;
const X25519_SECRET_KEY = /^AGE-SECRET-KEY-1[02-9AC-HJ-NP-Z]{58}$/;

export async function encrypt(
  plaintext: Uint8Array,
  target: readonly (PublicIdentity | string)[] | Passphrase,
): Promise<Uint8Array> {
  const bytes = copyBytes(plaintext);
  const encrypter = new Encrypter();
  if (isPassphrase(target)) {
    encrypter.setPassphrase(readPassphrase(target));
  } else {
    if (!Array.isArray(target) || target.length === 0) {
      throw new TypeError("Encrypt needs at least one recipient");
    }
    for (const recipient of target) encrypter.addRecipient(toRecipient(recipient));
  }
  return encrypter.encrypt(bytes);
}

export async function decrypt(
  ciphertext: Uint8Array,
  key: Identity | string | Passphrase,
): Promise<Uint8Array> {
  const bytes = copyBytes(ciphertext);
  const decrypter = new Decrypter();
  if (typeof key === "string") {
    if (!X25519_SECRET_KEY.test(key)) throw new TypeError("Expected an age X25519 secret key");
    decrypter.addIdentity(key);
    return decrypter.decrypt(bytes);
  }
  if (isPassphrase(key)) {
    decrypter.addPassphrase(readPassphrase(key));
    return decrypter.decrypt(bytes);
  }
  if (typeof key?.withX25519Secret !== "function") {
    throw new TypeError("Decrypt needs an Identity, an age secret key or a passphrase");
  }
  return key.withX25519Secret((secret) => {
    const words = bech32.toWords(secret);
    try {
      decrypter.addIdentity(bech32.encode("age-secret-key-", words).toUpperCase());
    } finally {
      words.fill(0);
    }
    return decrypter.decrypt(bytes);
  });
}

function toRecipient(recipient: PublicIdentity | string): string {
  if (typeof recipient === "string") {
    if (!X25519_RECIPIENT.test(recipient)) throw new TypeError("Expected an age X25519 recipient");
    return recipient;
  }
  const publicKey = base64urlnopad.decode(validatePublicIdentity(recipient).publicKey);
  return bech32.encode("age", bech32.toWords(ed25519.utils.toMontgomery(publicKey)));
}

function isPassphrase(value: unknown): value is Passphrase {
  return typeof value === "object" && value !== null && Object.hasOwn(value, "passphrase");
}

function readPassphrase({ passphrase }: Passphrase): string {
  if (typeof passphrase !== "string" || passphrase === "") {
    throw new TypeError("A passphrase must be a nonempty string");
  }
  return passphrase;
}

// age reads its input after the first await, so the caller's buffer is copied first.
function copyBytes(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new TypeError("Expected bytes");
  return value.slice();
}

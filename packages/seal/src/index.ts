import {
  validatePublicIdentity,
  verify,
  type Identity,
  type PublicIdentity,
} from "@ternent/identity";
import { base64urlnopad, hex } from "@scure/base";

export type SealHash = `sha256:${string}`;

export type SealProof = {
  format: "seal";
  version: 1;
  createdAt: string;
  subject: { hash: SealHash };
  signer: PublicIdentity;
  signature: string;
};

export type SealVerification = { valid: boolean; signatureValid: boolean; hashMatch: boolean };

export async function createSealHash(bytes: Uint8Array<ArrayBuffer>): Promise<SealHash> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return `sha256:${hex.encode(new Uint8Array(digest))}`;
}

export async function createSealProof(input: {
  signer: Pick<Identity, "publicIdentity" | "sign">;
  subject: { hash: SealHash };
  createdAt?: string;
}): Promise<SealProof> {
  const { publicKey, id } = input.signer.publicIdentity;
  const hash = input.subject.hash;
  const createdAt = input.createdAt ?? new Date().toISOString();
  if (!isSealHash(hash)) throw new TypeError("Subject hash must be sha256: and 64 lowercase hex");
  if (!isTimestamp(createdAt)) throw new TypeError("createdAt must be a UTC timestamp");

  const signer: PublicIdentity = { version: 1, algorithm: "Ed25519", publicKey, id };
  const unsigned = { format: "seal", version: 1, createdAt, subject: { hash }, signer } as const;
  const message = signingMessage(unsigned);
  const signature = await input.signer.sign(message.slice());
  if (!(await verify(signer, message, signature))) {
    throw new Error("The signer returned a signature that does not verify");
  }
  return { ...unsigned, signature: base64urlnopad.encode(signature) };
}

export async function verifySealProof(
  proof: unknown,
  bytes: Uint8Array<ArrayBuffer>,
): Promise<SealVerification> {
  const actualHash = createSealHash(bytes);
  let claimedHash: string | undefined;
  let signatureValid = false;
  try {
    const { signature, signer: claimedSigner, ...unsigned } = readProof(proof);
    claimedHash = unsigned.subject.hash;
    const signer = validatePublicIdentity(claimedSigner);
    signatureValid = await verify(
      signer,
      signingMessage({ ...unsigned, signer }),
      base64urlnopad.decode(signature),
    );
  } catch {
    // A malformed proof is an invalid proof.
  }
  const hashMatch = claimedHash === (await actualHash);
  return { valid: signatureValid && hashMatch, signatureValid, hashMatch };
}

// "ternent-seal/v1" || 0x00 || canonical JSON of the unsigned proof. Every value is a
// fixed-format ASCII string or the integer 1, so building the record with its keys
// in UTF-16 order makes JSON.stringify canonical.
function signingMessage(proof: Omit<SealProof, "signature">): Uint8Array {
  const { createdAt, format, signer, subject, version } = proof;
  const canonical = JSON.stringify({
    createdAt,
    format,
    signer: {
      algorithm: signer.algorithm,
      id: signer.id,
      publicKey: signer.publicKey,
      version: signer.version,
    },
    subject: { hash: subject.hash },
    version,
  });
  return new TextEncoder().encode(`ternent-seal/v1\0${canonical}`);
}

function readProof(input: unknown): Omit<SealProof, "signer"> & { signer: unknown } {
  if (!hasExactKeys(input, ["format", "version", "createdAt", "subject", "signer", "signature"])) {
    throw new TypeError("Invalid proof");
  }
  const { format, version, createdAt, subject, signer, signature } = input;
  if (
    format !== "seal" ||
    version !== 1 ||
    !isTimestamp(createdAt) ||
    !hasExactKeys(subject, ["hash"]) ||
    !isSealHash(subject.hash) ||
    typeof signature !== "string"
  ) {
    throw new TypeError("Invalid proof");
  }
  return {
    format,
    version,
    createdAt,
    subject: { hash: subject.hash },
    signer,
    signature,
  };
}

function hasExactKeys<K extends string>(value: unknown, keys: K[]): value is Record<K, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isSealHash(value: unknown): value is SealHash {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value);
}

function isTimestamp(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) &&
    new Date(value).toISOString() === value
  );
}

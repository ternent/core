import { readFile } from "node:fs/promises";
import { parseIdentity, validateIdentity, type SerializedIdentity } from "@ternent/identity";
import { SealCliError, EXIT_KEY_CONFIG } from "./errors.js";

export async function resolveSealIdentityFromEnv(
  env: Record<string, string | undefined>,
): Promise<SerializedIdentity> {
  const identityJson = String(env.SEAL_IDENTITY || "").trim();
  const identityFile = String(env.SEAL_IDENTITY_FILE || "").trim();
  if (!identityJson && !identityFile)
    throw new SealCliError(
      "Missing SEAL_IDENTITY or SEAL_IDENTITY_FILE environment variable.",
      EXIT_KEY_CONFIG,
    );
  try {
    return await validateIdentity(
      parseIdentity(identityJson || (await readFile(identityFile, "utf8"))),
    );
  } catch {
    throw new SealCliError("Invalid Seal identity configuration.", EXIT_KEY_CONFIG);
  }
}

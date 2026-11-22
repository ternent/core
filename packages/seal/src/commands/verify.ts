import { SealCliError, EXIT_INVALID_PROOF } from "../errors.js";
import { readFile } from "node:fs/promises";
import {
  parseSealArtifactJson,
  verifySealArtifact,
  type SealArtifactV1,
  type VerifySealArtifactResult,
} from "../artifact.js";
import { parseSealProofJson, verifySealProofAgainstBytes, type SealProofV2 } from "../proof.js";

export type VerifyArtifactResult = {
  valid: boolean;
  hashMatch: boolean;
  signatureValid: boolean;
  keyId: string;
  algorithm: "Ed25519";
  subjectHash: `sha256:${string}`;
};

export async function verifyProofArtifact(params: {
  proofPath: string;
  inputPath: string;
}): Promise<{
  proof: SealProofV2;
  result: VerifyArtifactResult;
}> {
  const rawProof = await readFile(params.proofPath, "utf8");
  const parsed = parseSealProofJson(rawProof);
  if (!parsed.ok || !parsed.proof) {
    throw new SealCliError(parsed.errors.join(" "), EXIT_INVALID_PROOF);
  }

  const subjectBytes = await readFile(params.inputPath);
  const result = await verifySealProofAgainstBytes(parsed.proof, subjectBytes);
  return {
    proof: parsed.proof,
    result,
  };
}

export async function verifyArtifactProof(params: { artifactPath: string }): Promise<{
  artifact: SealArtifactV1;
  result: VerifySealArtifactResult;
}> {
  const rawArtifact = await readFile(params.artifactPath, "utf8");
  const parsed = parseSealArtifactJson(rawArtifact);
  if (!parsed.ok || !parsed.artifact) {
    throw new SealCliError(parsed.errors.join(" "), EXIT_INVALID_PROOF);
  }

  return {
    artifact: parsed.artifact,
    result: await verifySealArtifact(parsed.artifact),
  };
}

import { basename } from "node:path";
import { readFile } from "node:fs/promises";
import { createSealArtifact, type SealArtifactV1 } from "../artifact.js";
import { parseSealManifestJson } from "../manifest.js";
import { createSealProof, createSealHash, type SealProofV2 } from "../proof.js";

export async function createProofArtifact(params: {
  inputPath: string;
  identity: import("@ternent/identity").SerializedIdentity;
}): Promise<{
  proof: SealProofV2;
  content: string;
}> {
  const bytes = await readFile(params.inputPath);
  const raw = new TextDecoder().decode(bytes);
  const parsedManifest = parseSealManifestJson(raw);
  const proof = await createSealProof({
    signer: {
      identity: params.identity,
    },
    subject: {
      kind: parsedManifest.ok ? "manifest" : "file",
      path: basename(params.inputPath),
      hash: await createSealHash(bytes),
    },
  });

  return {
    proof,
    content: `${JSON.stringify(proof, null, 2)}\n`,
  };
}

export async function createRecipientArtifact(params: {
  inputPath: string;
  identity: import("@ternent/identity").SerializedIdentity;
  recipients: string[];
}): Promise<{
  artifact: SealArtifactV1;
  content: string;
}> {
  const bytes = await readFile(params.inputPath);
  const artifact = await createSealArtifact({
    signer: {
      identity: params.identity,
    },
    subjectPath: basename(params.inputPath),
    payload: bytes,
    recipients: params.recipients,
  });

  return {
    artifact,
    content: `${JSON.stringify(artifact, null, 2)}\n`,
  };
}

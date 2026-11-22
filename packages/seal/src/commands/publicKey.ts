import { createSealPublicKeyArtifact } from "../proof.js";

export async function createPublicKeyArtifact(params: {
  identity: import("@ternent/identity").SerializedIdentity;
}) {
  return createSealPublicKeyArtifact(params);
}

import { readFileSync } from "node:fs";
import type { SerializedIdentity } from "@ternent/identity";
import type { createSealProof } from "../src/proof.js";
import type { SealManifestV1 } from "../src/manifest.js";

type Proof = Awaited<ReturnType<typeof createSealProof>>;
export type SealVector = {
  seedHex: string;
  identity: SerializedIdentity;
  contentUtf8: string;
  subjectHash: `sha256:${string}`;
  context: string;
  signingPayload: string;
  messageHex: string;
  proof: Proof;
  manifest: SealManifestV1;
  canonicalManifest: string;
};
export const sealVector = (): SealVector =>
  JSON.parse(
    readFileSync(new URL("../../../docs/seal/vectors/proof.v2.json", import.meta.url), "utf8"),
  ) as SealVector;

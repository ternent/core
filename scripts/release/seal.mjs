import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseSealManifestJson } from "../../packages/seal/dist/manifest.js";
import {
  createSealHash,
  parseSealProofJson,
  parseSealPublicKeyJson,
  verifySealProofAgainstBytes,
} from "../../packages/seal/dist/proof.js";

const outputs = new Set(["release-manifest.json", "release-proof.json", "release-public-key.json"]);

/** @param {string} directory @param {string} [prefix] @returns {string[]} */
function bundleFiles(directory, prefix = "") {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap((entry) => {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    assert(!entry.isSymbolicLink(), `SEAL_BUNDLE_INVALID: symbolic link ${path}`);
    if (entry.isDirectory()) return bundleFiles(directory, path);
    assert(entry.isFile(), `SEAL_BUNDLE_INVALID: unsupported file ${path}`);
    return outputs.has(path) ? [] : [path];
  });
}

/**
 * The trusted key comes from repository/environment configuration, never from the bundle.
 * @param {{directory: string, expectedPublicKey: string}} input
 */
export async function verifyReleaseSeal({ directory, expectedPublicKey }) {
  assert(expectedPublicKey?.trim(), "SEAL_TRUST_MISSING: configure the release public key");
  const manifestBytes = readFileSync(join(directory, "release-manifest.json"));
  const parsedManifest = parseSealManifestJson(manifestBytes.toString("utf8"));
  const parsedProof = parseSealProofJson(
    readFileSync(join(directory, "release-proof.json"), "utf8"),
  );
  const parsedKey = parseSealPublicKeyJson(
    readFileSync(join(directory, "release-public-key.json"), "utf8"),
  );
  assert(parsedManifest.ok && parsedManifest.manifest, "SEAL_MANIFEST_INVALID");
  assert(parsedProof.ok && parsedProof.proof, "SEAL_PROOF_INVALID");
  assert(parsedKey.ok && parsedKey.artifact, "SEAL_PUBLIC_KEY_INVALID");
  const proof = parsedProof.proof;
  const key = parsedKey.artifact;
  assert.equal(proof.signer.publicKey, expectedPublicKey.trim(), "SEAL_SIGNER_UNTRUSTED");
  assert.equal(key.publicKey, expectedPublicKey.trim(), "SEAL_PUBLIC_KEY_UNTRUSTED");
  assert.equal(key.keyId, proof.signer.keyId, "SEAL_KEY_BINDING_INVALID");
  assert.equal(proof.subject.kind, "manifest", "SEAL_SUBJECT_INVALID");
  assert.equal(proof.subject.path, "release-manifest.json", "SEAL_SUBJECT_INVALID");
  assert((await verifySealProofAgainstBytes(proof, manifestBytes)).valid, "SEAL_SIGNATURE_INVALID");
  const files = bundleFiles(directory).sort();
  assert(files.includes("release-plan.json"), "SEAL_PLAN_MISSING");
  assert.deepEqual(
    Object.keys(parsedManifest.manifest.files).sort(),
    files,
    "SEAL_FILE_SET_INVALID",
  );
  for (const path of files)
    assert.equal(
      await createSealHash(readFileSync(join(directory, path))),
      parsedManifest.manifest.files[path],
      `SEAL_FILE_CHANGED: ${path}`,
    );
}

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createSealIdentity } from "../../packages/seal/dist/crypto.js";
import { verifyReleaseSeal } from "./seal.mjs";

await test("Seal binds the complete release bundle to an externally trusted key", async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ternent-release-seal-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const identity = await createSealIdentity();
  const env = { ...process.env, SEAL_IDENTITY: JSON.stringify(identity), SEAL_IDENTITY_FILE: "" };
  const cli = resolve("packages/seal/bin/seal");
  /** @param {string[]} args */
  const run = (args) => execFileSync(process.execPath, [cli, ...args], { env, encoding: "utf8" });
  writeFileSync(join(directory, "release-plan.json"), '{"releaseId":"tested-plan"}\n');
  writeFileSync(join(directory, "candidate.tgz"), "immutable candidate bytes");
  run([
    "manifest",
    "create",
    "--input",
    directory,
    "--out",
    join(directory, "release-manifest.json"),
    "--quiet",
  ]);
  run([
    "sign",
    "--input",
    join(directory, "release-manifest.json"),
    "--out",
    join(directory, "release-proof.json"),
    "--quiet",
  ]);
  const publicKey = JSON.parse(run(["public-key", "--json"]));
  writeFileSync(join(directory, "release-public-key.json"), JSON.stringify(publicKey));
  const verify = () => verifyReleaseSeal({ directory, expectedPublicKey: publicKey.publicKey });
  await verify();
  await assert.rejects(
    () => verifyReleaseSeal({ directory, expectedPublicKey: "" }),
    /SEAL_TRUST_MISSING/,
  );
  await assert.rejects(
    () => verifyReleaseSeal({ directory, expectedPublicKey: "untrusted" }),
    /SEAL_SIGNER_UNTRUSTED/,
  );
  writeFileSync(join(directory, "candidate.tgz"), "tampered");
  await assert.rejects(verify, /SEAL_FILE_CHANGED/);
  writeFileSync(join(directory, "candidate.tgz"), "immutable candidate bytes");
  writeFileSync(join(directory, "extra.tgz"), "unlisted");
  await assert.rejects(verify, /SEAL_FILE_SET_INVALID/);
  rmSync(join(directory, "extra.tgz"));
  symlinkSync(join(directory, "candidate.tgz"), join(directory, "linked.tgz"));
  await assert.rejects(verify, /symbolic link/);
  rmSync(join(directory, "linked.tgz"));
  const proofPath = join(directory, "release-proof.json");
  const proof = JSON.parse(readFileSync(proofPath, "utf8"));
  proof.subject.path = "other.json";
  writeFileSync(proofPath, JSON.stringify(proof));
  await assert.rejects(verify, /SEAL_SUBJECT_INVALID/);
  proof.subject.path = "release-manifest.json";
  proof.signature = "A".repeat(86);
  writeFileSync(proofPath, JSON.stringify(proof));
  await assert.rejects(verify, /SEAL_SIGNATURE_INVALID/);
});

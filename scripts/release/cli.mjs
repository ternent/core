import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createSealIdentity } from "../../packages/seal/dist/crypto.js";
import { createSealPublicKeyArtifact } from "../../packages/seal/dist/proof.js";
import { workspacePackages, readManifest } from "../verify/workspace.mjs";
import { createPlan, validatePlan } from "./plan.mjs";
import { publishRelease } from "./publish.mjs";
import { createNpmRegistryAdapter } from "./npm.mjs";
import { ReleaseError, sha256 } from "./shared.mjs";
import { verifyReleaseSeal } from "./seal.mjs";

const [command, argument, ...extra] = process.argv.slice(2);
assert(extra.length === 0, "Unexpected release arguments");
const root = process.cwd();
const directory = resolve(argument ?? "artifacts/release");
const expectedPublicKey = (process.env.SEAL_RELEASE_PUBLIC_KEY ?? "").trim();

/** @param {string} sha */
function committedIntent(sha) {
  try {
    return execFileSync("git", ["show", `${sha}:release-intent.json`], {
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    throw new ReleaseError(
      "COMMITTED_INTENT_REQUIRED",
      "Release intent must exist in the selected commit",
    );
  }
}

/** Bind checkout/bundle to the upstream producer, not workflow_run's newer SHA. */
function releaseSource() {
  const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.equal(sourceSha, process.env.RELEASE_SOURCE_SHA, "SOURCE_REVISION_MISMATCH");
  const origin = JSON.parse(readFileSync(resolve("artifacts/release-origin.json"), "utf8"));
  assert.equal(origin.schema, 1, "ORIGIN_INVALID");
  assert.equal(origin.repository, "ternent/core", "ORIGIN_INVALID");
  assert.equal(origin.sourceSha, sourceSha, "ORIGIN_INVALID");
  assert.equal(String(origin.runId), process.env.RELEASE_RUN_ID, "ORIGIN_INVALID");
  assert.equal(String(origin.artifactId), process.env.RELEASE_ARTIFACT_ID, "ORIGIN_INVALID");
  assert.equal(origin.artifactDigest, process.env.RELEASE_ARTIFACT_DIGEST, "ORIGIN_INVALID");
  const plan = validatePlan(
    JSON.parse(readFileSync(join(directory, "release-plan.json"), "utf8")),
    { directory, expectedSourceSha: sourceSha },
  );
  assert.equal(origin.releaseId, plan.releaseId, "ORIGIN_INVALID");
  assert.equal(sha256(readFileSync("pnpm-lock.yaml")), plan.lockfileSha256, "LOCKFILE_MISMATCH");
  assert(plan.intentSha256 && plan.packages.length === 5, "COMMITTED_INTENT_REQUIRED");
  assert.equal(sha256(committedIntent(sourceSha)), plan.intentSha256, "COMMITTED_INTENT_REQUIRED");
  return { plan, origin };
}

/** This guard complements npm's workflow-bound OIDC checks; it does not provision trust. */
function authorize() {
  assert.equal(process.env.GITHUB_ACTIONS, "true", "RELEASE_WORKFLOW_REQUIRED");
  assert.equal(process.env.GITHUB_REPOSITORY, "ternent/core", "RELEASE_REPOSITORY_INVALID");
  assert.equal(process.env.GITHUB_REF, "refs/heads/main", "RELEASE_REF_INVALID");
  assert.equal(
    process.env.GITHUB_WORKFLOW_REF,
    "ternent/core/.github/workflows/release.yml@refs/heads/main",
    "RELEASE_WORKFLOW_INVALID",
  );
  assert.equal(process.env.CORE_RELEASE_ENABLED, "true", "RELEASE_NOT_ENABLED");
  assert(expectedPublicKey, "SEAL_TRUST_MISSING");
  assert(
    !process.env.NPM_TOKEN && !process.env.NODE_AUTH_TOKEN,
    "OIDC_ONLY: remove token fallback",
  );
  assert.equal(
    execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
    "12.2.3",
    "Use pinned npm 12.2.3 for OIDC publish and dist-tags",
  );
}

try {
  if (command === "plan" || command === "verification-plan") {
    assert.equal(
      execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {
        encoding: "utf8",
      }).trim(),
      "",
      "COMMITTED_SOURCE_REQUIRED",
    );
    const head = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
    if (process.env.GITHUB_SHA)
      assert.equal(head, process.env.GITHUB_SHA, "SOURCE_REVISION_MISMATCH");
    if (existsSync("release-intent.json"))
      assert.deepEqual(
        readFileSync("release-intent.json"),
        committedIntent(head),
        "COMMITTED_INTENT_REQUIRED",
      );
    // Verification can retain a no-op bundle before version allocation. Production
    // planning checks parent versions so new versions cannot omit release intent.
    const previousVersions =
      command === "verification-plan"
        ? Object.fromEntries(
            workspacePackages(root).map((entry) => [entry.name, readManifest(entry.path).version]),
          )
        : undefined;
    const result = createPlan({ root, directory, previousVersions });
    console.log(
      JSON.stringify({
        status: result.status,
        releaseId: result.plan.releaseId,
        sourceSha: result.plan.sourceSha,
      }),
    );
  } else if (command === "test-identity") {
    assert(!argument, "test-identity takes no directory argument");
    const identity = await createSealIdentity();
    const file = join(process.env.RUNNER_TEMP ?? tmpdir(), `ternent-seal-ci-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    const key = await createSealPublicKeyArtifact({ identity });
    assert(process.env.GITHUB_OUTPUT, "GITHUB_OUTPUT_REQUIRED");
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `identity-file=${file}\npublic-key=${key.publicKey}\nnode=${process.execPath}\n`,
    );
  } else if (command === "prepare-release") {
    authorize();
    const { plan, origin } = releaseSource();
    if (process.env.RELEASE_RESUMED === "true") {
      await verifyReleaseSeal({ directory, expectedPublicKey });
      assert.deepEqual(
        JSON.parse(readFileSync(join(directory, "release-origin.json"), "utf8")),
        origin,
        "ORIGIN_INVALID",
      );
    } else {
      // GitHub archive provenance authenticates the producer. Its disposable proof
      // establishes consistency here, not trust in a production release signer.
      const testKey = JSON.parse(readFileSync(join(directory, "release-public-key.json"), "utf8"));
      await verifyReleaseSeal({ directory, expectedPublicKey: testKey.publicKey });
      for (const file of ["release-manifest.json", "release-proof.json", "release-public-key.json"])
        rmSync(join(directory, file));
      writeFileSync(join(directory, "release-origin.json"), `${JSON.stringify(origin)}\n`);
    }
    validatePlan(plan, { directory, expectedSourceSha: origin.sourceSha });
    console.log(
      JSON.stringify({
        phase: "prepared",
        releaseId: plan.releaseId,
        sourceSha: plan.sourceSha,
        resumed: process.env.RELEASE_RESUMED === "true",
      }),
    );
  } else if (command === "release-identity") {
    authorize();
    assert(process.env.GITHUB_OUTPUT && process.env.RUNNER_TEMP, "RUNNER_CONFIGURATION_REQUIRED");
    const encoded = process.env.SEAL_RELEASE_IDENTITY_B64;
    assert(encoded, "RELEASE_IDENTITY_MISSING");
    let identity;
    try {
      identity = JSON.parse(Buffer.from(encoded, "base64").toString("utf8"));
    } catch {
      throw new Error("RELEASE_IDENTITY_INVALID");
    }
    assert(
      typeof identity?.material?.seed === "string" &&
        /^[A-Za-z0-9_-]{43}$/.test(identity.material.seed),
      "RELEASE_IDENTITY_INVALID",
    );
    console.log(`::add-mask::${identity.material.seed}`);
    console.log(`::add-mask::${JSON.stringify(identity)}`);
    let key;
    try {
      key = await createSealPublicKeyArtifact({ identity });
    } catch {
      throw new Error("RELEASE_IDENTITY_INVALID");
    }
    assert.equal(key.publicKey, expectedPublicKey, "RELEASE_IDENTITY_KEY_MISMATCH");
    const file = join(process.env.RUNNER_TEMP, `ternent-seal-release-${process.pid}.json`);
    writeFileSync(file, JSON.stringify(identity), { mode: 0o600, flag: "wx" });
    appendFileSync(process.env.GITHUB_OUTPUT, `identity-file=${file}\n`);
  } else if (command === "verify-seal") {
    await verifyReleaseSeal({ directory, expectedPublicKey });
    console.log("Seal release bundle verified");
  } else if (command === "publish") {
    authorize();
    const { plan, origin } = releaseSource();
    assert.deepEqual(
      JSON.parse(readFileSync(join(directory, "release-origin.json"), "utf8")),
      origin,
      "ORIGIN_INVALID",
    );
    const receipt = await publishRelease({
      plan,
      directory,
      registry: createNpmRegistryAdapter({ authorize, sourceSha: plan.sourceSha }),
      verifySeal: () => verifyReleaseSeal({ directory, expectedPublicKey }),
      verifyConsumers: async () => {
        execFileSync("pnpm", ["run", "check:artifact"], {
          cwd: root,
          stdio: "inherit",
          env: {
            ...process.env,
            GITHUB_SHA: plan.sourceSha,
            VERIFY_PUBLISHED_BUNDLE: directory,
            VERIFY_COMPATIBILITY: "true",
            NPM_CONFIG_USERCONFIG: "/dev/null",
          },
        });
      },
      journalPath: resolve("artifacts/release-receipt.json"),
    });
    console.log(JSON.stringify(receipt));
  } else
    throw new Error(
      "Usage: release CLI plan|verification-plan|test-identity|prepare-release|release-identity|verify-seal|publish [bundle directory]",
    );
} catch (error) {
  const details =
    error instanceof ReleaseError
      ? {
          code: error.code,
          phase: error.phase,
          sourceSha: error.sourceSha,
          releaseId: error.releaseId,
          retryable: error.retryable,
        }
      : { code: "RELEASE_REJECTED", phase: "release", retryable: false };
  console.error(JSON.stringify({ ...details, error: String(error) }));
  process.exitCode = 1;
}

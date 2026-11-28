import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { workspacePackages, readManifest } from "../verify/workspace.mjs";
import { createPlan, validatePlan } from "./plan.mjs";
import { publishRelease } from "./publish.mjs";
import { createNpmRegistryAdapter } from "./npm.mjs";
import { ReleaseError, sha256 } from "./shared.mjs";

const [command, argument, ...extra] = process.argv.slice(2);
assert(extra.length === 0, "Unexpected release arguments");
const root = process.cwd();
const directory = resolve(argument ?? "artifacts/release");

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
  } else if (command === "prepare-release") {
    authorize();
    const { plan, origin } = releaseSource();
    if (process.env.RELEASE_RESUMED === "true") {
      assert.deepEqual(
        JSON.parse(readFileSync(join(directory, "release-origin.json"), "utf8")),
        origin,
        "ORIGIN_INVALID",
      );
    } else {
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
      registry: createNpmRegistryAdapter({
        authorize,
        sourceSha: plan.sourceSha,
        channel: plan.channel,
      }),
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
      "Usage: release CLI plan|verification-plan|prepare-release|publish [bundle directory]",
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

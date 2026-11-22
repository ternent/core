import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { createSealIdentity } from "../../packages/seal/dist/crypto.js";
import { createSealPublicKeyArtifact } from "../../packages/seal/dist/proof.js";
import { fixture } from "./fixtures.mjs";
import { createPlan } from "./plan.mjs";
import { captureTools } from "./flow.mjs";
import { sha256, writeJson } from "./shared.mjs";

await test("release entrypoint rejects uncommitted intent and local publication", (t) => {
  const directory = mkdtempSync(join(tmpdir(), "ternent-release-entrypoint-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const cli = resolve("scripts/release/cli.mjs");
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: directory,
      stdio: "ignore",
    });
  git(["init"]);
  writeFileSync(join(directory, "README.md"), "Committed source\n");
  git(["add", "README.md"]);
  git([
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  writeFileSync(join(directory, "release-intent.json"), '{"schema":1}\n');
  const env = { ...process.env, GITHUB_ACTIONS: "false", GITHUB_SHA: "" };
  const planned = spawnSync(process.execPath, [cli, "plan"], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
  assert.equal(planned.status, 1);
  assert.match(planned.stderr, /COMMITTED_INTENT_REQUIRED/);
  const published = spawnSync(process.execPath, [cli, "publish"], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
  assert.equal(published.status, 1);
  assert.match(published.stderr, /RELEASE_WORKFLOW_REQUIRED/);
});

await test("production entrypoint preserves verified candidates through signing and resume", async (t) => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  const cli = resolve("scripts/release/cli.mjs");
  const seal = resolve("packages/seal/bin/seal");
  /** @param {string[]} args */
  const git = (args) =>
    execFileSync("git", ["-c", "core.hooksPath=/dev/null", "-c", "commit.gpgsign=false", ...args], {
      cwd: f.root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  git(["init"]);
  git(["add", "package.json", "pnpm-lock.yaml", "release-intent.json"]);
  git([
    "-c",
    "user.name=Release test",
    "-c",
    "user.email=release@example.invalid",
    "commit",
    "-m",
    "fixture",
  ]);
  const sourceSha = git(["rev-parse", "HEAD"]).trim();
  for (const name of ["check", "consumers"]) {
    const file = join(f.root, `artifacts/${name}.json`);
    writeJson(file, { ...JSON.parse(readFileSync(file, "utf8")), sourceSha });
  }
  const directory = join(f.root, "artifacts/release");
  const { plan } = createPlan({ ...f.planOptions, sourceSha, directory, now: new Date() });
  captureTools(process.cwd(), directory);
  const before = plan.packages.map((pkg) => sha256(readFileSync(join(directory, pkg.tarball))));
  const signer = await createSealIdentity();
  const trusted = await createSealPublicKeyArtifact({ identity: signer });
  const producer = await createSealIdentity();
  const bin = join(f.root, "bin");
  mkdirSync(bin);
  writeFileSync(
    join(bin, "npm"),
    '#!/bin/sh\nif [ "$1" = "--version" ]; then echo 12.2.3; else exit 93; fi\n',
  );
  chmodSync(join(bin, "npm"), 0o700);
  const output = join(f.root, "outputs");
  const origin = {
    schema: 1,
    repository: "ternent/core",
    sourceSha,
    runId: 123,
    artifactId: 456,
    artifactDigest: `sha256:${"a".repeat(64)}`,
    releaseId: plan.releaseId,
  };
  writeJson(join(f.root, "artifacts/release-origin.json"), origin);
  const env = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    GITHUB_ACTIONS: "true",
    GITHUB_REPOSITORY: "ternent/core",
    GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: "ternent/core/.github/workflows/release.yml@refs/heads/main",
    CORE_RELEASE_ENABLED: "true",
    RELEASE_SOURCE_SHA: sourceSha,
    RELEASE_RUN_ID: "123",
    RELEASE_ARTIFACT_ID: "456",
    RELEASE_ARTIFACT_DIGEST: origin.artifactDigest,
    SEAL_RELEASE_PUBLIC_KEY: trusted.publicKey,
    RUNNER_TEMP: f.root,
    GITHUB_OUTPUT: output,
    NPM_TOKEN: "",
    NODE_AUTH_TOKEN: "",
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
    ACTIONS_ID_TOKEN_REQUEST_TOKEN: "",
    ACTIONS_ID_TOKEN_REQUEST_URL: "",
    SEAL_IDENTITY: "",
    SEAL_IDENTITY_FILE: "",
    RELEASE_RESUMED: "false",
  };
  /** @param {string} command @param {NodeJS.ProcessEnv} [overrides] */
  function entry(command, overrides = {}) {
    const result = spawnSync(process.execPath, [cli, command], {
      cwd: f.root,
      env: { ...env, ...overrides },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    // stdout may contain GitHub mask commands for a synthetic secret; never log it.
  }
  /** @param {NodeJS.ProcessEnv} credentials */
  function sign(credentials) {
    /** @param {string[]} args */
    const run = (args) =>
      execFileSync(process.execPath, [seal, ...args], {
        cwd: f.root,
        env: { ...env, ...credentials },
        encoding: "utf8",
      });
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
    writeFileSync(join(directory, "release-public-key.json"), run(["public-key", "--json"]));
  }
  sign({ SEAL_IDENTITY: JSON.stringify(producer) });
  entry("prepare-release");
  assert(!existsSync(join(directory, "release-proof.json")));
  assert.deepEqual(
    JSON.parse(readFileSync(join(directory, "release-origin.json"), "utf8")),
    origin,
  );
  entry("release-identity", {
    SEAL_RELEASE_IDENTITY_B64: Buffer.from(JSON.stringify(signer)).toString("base64"),
  });
  const identityFile = readFileSync(output, "utf8").trim().slice("identity-file=".length);
  assert.equal(statSync(identityFile).mode & 0o777, 0o600);
  assert(!identityFile.startsWith(`${directory}/`));
  sign({ SEAL_IDENTITY_FILE: identityFile });
  entry("verify-seal");
  const proof = readFileSync(join(directory, "release-proof.json"));
  const receipt = '{"state":"partial","attempt":1}\n';
  writeFileSync(join(f.root, "artifacts/release-receipt.json"), receipt);
  entry("prepare-release", { RELEASE_RESUMED: "true" });
  assert.deepEqual(readFileSync(join(directory, "release-proof.json")), proof);
  assert.equal(readFileSync(join(f.root, "artifacts/release-receipt.json"), "utf8"), receipt);
  assert.deepEqual(
    plan.packages.map((pkg) => sha256(readFileSync(join(directory, pkg.tarball)))),
    before,
  );
  const rejected = spawnSync(process.execPath, [cli, "prepare-release"], {
    cwd: f.root,
    env: { ...env, RELEASE_RESUMED: "true", SEAL_RELEASE_PUBLIC_KEY: "wrong" },
    encoding: "utf8",
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /SEAL_SIGNER_UNTRUSTED/);
});

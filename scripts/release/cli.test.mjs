import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";

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

import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAllocations, ensureAlphaMode } from "./version.mjs";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

await test("version allocation checks observed registry history before changing manifests", async () => {
  const releases = [{ name: "@ternent/identity", newVersion: "0.7.0-alpha.0" }];
  await validateAllocations(releases, async () => ["0.6.0", "not-a-version"]);
  await assert.rejects(
    () => validateAllocations(releases, async () => ["0.7.0-alpha.0"]),
    /VERSION_ALREADY_EXISTS/,
  );
  await assert.rejects(
    () => validateAllocations(releases, async () => ["1.0.0"]),
    /VERSION_SEQUENCE_RESET/,
  );
  await assert.rejects(
    () => validateAllocations([{ name: "@ternent/identity", newVersion: "1.0.0" }], async () => []),
    /ALPHA_VERSION_REQUIRED/,
  );
  await assert.rejects(() => validateAllocations([], async () => []), /VERSION_INTENT_EMPTY/);
});

await test("first alpha setup checks npm baselines before entering prerelease mode", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "ternent-alpha-mode-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".changeset"));
  /** @type {string[][]} */ const calls = [];
  const packages = [{ name: "@ternent/identity", version: "0.6.0-alpha.0" }];
  /** @param {string[]} args */
  function run(args) {
    calls.push(args);
    writeFileSync(join(root, ".changeset/pre.json"), JSON.stringify({ mode: "pre", tag: "alpha" }));
  }
  await assert.rejects(
    () => ensureAlphaMode({ root, packages, run, readVersions: async () => ["1.0.0"] }),
    /VERSION_SEQUENCE_RESET/,
  );
  assert(!existsSync(join(root, ".changeset/pre.json")));
  assert.deepEqual(calls, []);
  await ensureAlphaMode({ root, packages, run, readVersions: async () => ["0.5.0"] });
  assert.deepEqual(calls, [["exec", "changeset", "pre", "enter", "alpha"]]);
  await ensureAlphaMode({
    root,
    packages,
    run,
    readVersions: async () => {
      throw new Error("Existing alpha state must not reallocate its baseline");
    },
  });
  assert.equal(calls.length, 1);
  writeFileSync(join(root, ".changeset/pre.json"), JSON.stringify({ mode: "pre", tag: "beta" }));
  await assert.rejects(() => ensureAlphaMode({ root, packages, run }), /ALPHA_MODE_REQUIRED/);
});

await test("stable allocation accepts the release after its alpha and rejects prereleases, collisions and resets", async () => {
  const releases = [{ name: "@ternent/concord", newVersion: "0.3.0" }];
  await validateAllocations(releases, async () => ["0.2.9", "0.3.0-alpha.1"], "latest");
  await assert.rejects(
    validateAllocations([{ name: "@ternent/concord", newVersion: "0.3.0-alpha.2" }], async () => [], "latest"),
    /STABLE_VERSION_REQUIRED/,
  );
  await assert.rejects(validateAllocations(releases, async () => ["0.3.0"], "latest"), /VERSION_ALREADY_EXISTS/);
  await assert.rejects(validateAllocations(releases, async () => ["0.4.0"], "latest"), /VERSION_SEQUENCE_RESET/);
});

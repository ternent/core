import assert from "node:assert/strict";
import { test } from "node:test";
import { validateAllocations, ensureAlphaMode, versionRelease } from "./version.mjs";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./fixtures.mjs";

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
    validateAllocations(
      [{ name: "@ternent/concord", newVersion: "0.3.0-alpha.2" }],
      async () => [],
      "latest",
    ),
    /STABLE_VERSION_REQUIRED/,
  );
  await assert.rejects(
    validateAllocations(releases, async () => ["0.3.0"], "latest"),
    /VERSION_ALREADY_EXISTS/,
  );
  await assert.rejects(
    validateAllocations(releases, async () => ["0.4.0"], "latest"),
    /VERSION_SEQUENCE_RESET/,
  );
});

await test("Changesets exits alpha into a complete stable intent and keeps subsequent releases stable", async (t) => {
  const f = fixture();
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  writeFileSync(join(f.root, "pnpm-workspace.yaml"), "packages:\n  - packages/*\n");
  mkdirSync(join(f.root, ".changeset"));
  const config = JSON.parse(readFileSync(".changeset/config.json", "utf8"));
  writeFileSync(
    join(f.root, ".changeset/config.json"),
    JSON.stringify({ ...config, changelog: false }),
  );
  writeFileSync(
    join(f.root, ".changeset/pre.json"),
    JSON.stringify({ mode: "exit", tag: "alpha" }),
  );
  const releases = f.inventory.map((pkg) => `"${pkg.name}": patch`).join("\n");
  writeFileSync(
    join(f.root, ".changeset/stable.md"),
    `---\n${releases}\n---\nStable interfaces.\n`,
  );
  for (const pkg of f.inventory) {
    const path = join(pkg.path, "package.json");
    const manifest = JSON.parse(readFileSync(path, "utf8"));
    manifest.dependencies = Object.fromEntries(
      Object.keys(manifest.dependencies).map((name) => [name, "workspace:^"]),
    );
    writeFileSync(path, JSON.stringify(manifest));
  }
  await versionRelease(f.root, async () => ["0.9.0", "1.0.0-alpha.0"]);
  const intent = JSON.parse(readFileSync(join(f.root, "release-intent.json"), "utf8"));
  assert.equal(intent.channel, "latest");
  assert.equal(intent.packages.length, 5);
  assert(intent.packages.every((/** @type {any} */ pkg) => pkg.version === "1.0.0"));
  assert(!existsSync(join(f.root, ".changeset/pre.json")));
  assert(existsSync(join(f.root, "pnpm-lock.yaml")));
  writeFileSync(
    join(f.root, ".changeset/followup.md"),
    '---\n"@ternent/ledger": patch\n---\nStable follow-up.\n',
  );
  await versionRelease(f.root, async () => ["1.0.0"]);
  const next = JSON.parse(readFileSync(join(f.root, "release-intent.json"), "utf8"));
  assert.equal(next.channel, "latest");
  assert.equal(
    next.packages.find((/** @type {any} */ pkg) => pkg.name === "@ternent/ledger").version,
    "1.0.1",
  );
  assert(!existsSync(join(f.root, ".changeset/pre.json")));
});

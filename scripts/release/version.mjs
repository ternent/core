import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { compare, prerelease, valid } from "semver";
import { workspacePackages, readManifest } from "../verify/workspace.mjs";

/** @param {string} name */
async function publishedVersions(name) {
  const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) return [];
  assert(response.ok, `REGISTRY_UNAVAILABLE: ${name} (${response.status})`);
  const metadata = await response.json();
  assert(
    metadata?.versions &&
      typeof metadata.versions === "object" &&
      !Array.isArray(metadata.versions),
    `REGISTRY_INVALID: ${name}`,
  );
  return Object.keys(metadata.versions);
}

/**
 * Check allocation before Changesets writes package versions. Registry observations are
 * inputs, not proof of publication permission or a reservation of the version number.
 * @param {{name:string,newVersion:string}[]} releases
 * @param {(name:string)=>Promise<string[]>} readVersions
 * @param {'next'|'latest'} channel
 */
export async function validateAllocations(
  releases,
  readVersions = publishedVersions,
  channel = "next",
) {
  assert(channel === "next" || channel === "latest", "RELEASE_CHANNEL_INVALID");
  assert(releases.length > 0, "VERSION_INTENT_EMPTY: add a public library changeset first");
  for (const release of releases) {
    assert(
      valid(release.newVersion) &&
        (channel === "next"
          ? prerelease(release.newVersion)?.[0] === "alpha"
          : prerelease(release.newVersion) === null),
      `${channel === "next" ? "ALPHA" : "STABLE"}_VERSION_REQUIRED: ${release.name}`,
    );
    const versions = await readVersions(release.name);
    assert(
      !versions.includes(release.newVersion),
      `VERSION_ALREADY_EXISTS: ${release.name}@${release.newVersion}`,
    );
    assert(
      versions.filter((v) => valid(v)).every((v) => compare(release.newVersion, v) > 0),
      `VERSION_SEQUENCE_RESET: ${release.name}`,
    );
  }
}

/** Enter alpha mode only after checking that current baselines are ahead of npm.
 * @param {{root:string,packages:{name:string,version:string}[],run:(args:string[])=>unknown,readVersions?:(name:string)=>Promise<string[]>}} input
 */
export async function ensureAlphaMode({ root, packages, run, readVersions = publishedVersions }) {
  const prePath = join(root, ".changeset/pre.json");
  if (!existsSync(prePath)) {
    await validateAllocations(
      packages.map((pkg) => ({ name: pkg.name, newVersion: pkg.version })),
      readVersions,
    );
    run(["exec", "changeset", "pre", "enter", "alpha"]);
  }
  const pre = JSON.parse(readFileSync(prePath, "utf8"));
  assert(pre.mode === "pre" && pre.tag === "alpha", "ALPHA_MODE_REQUIRED");
}

/** @param {string} [root] @param {(name:string)=>Promise<string[]>} [readVersions] */
export async function versionRelease(root = process.cwd(), readVersions = publishedVersions) {
  const entries = workspacePackages(root)
    .map((entry) => ({ ...entry, manifest: readManifest(entry.path) }))
    .filter((entry) => !entry.manifest.private);
  assert.equal(entries.length, 5, "EXPECTED_FIVE_PUBLIC_LIBRARIES");
  const directory = mkdtempSync(join(tmpdir(), "ternent-version-plan-"));
  /** @param {string[]} args */
  const run = (args) => execFileSync("pnpm", args, { cwd: root, stdio: "inherit" });
  try {
    const prePath = join(root, ".changeset/pre.json");
    const pre = existsSync(prePath) ? JSON.parse(readFileSync(prePath, "utf8")) : null;
    assert(
      !pre || (pre.tag === "alpha" && ["pre", "exit"].includes(pre.mode)),
      "ALPHA_MODE_REQUIRED",
    );
    const channel = pre?.mode === "pre" ? "next" : "latest";
    if (channel === "next")
      await ensureAlphaMode({
        root,
        packages: entries.map((entry) => ({ name: entry.name, version: entry.manifest.version })),
        run,
        readVersions,
      });
    const output = join(directory, "status.json");
    run(["exec", "changeset", "status", "--output", output]);
    const status = JSON.parse(readFileSync(output, "utf8"));
    const names = new Set(entries.map((entry) => entry.name));
    /** @type {{name:string,newVersion:string}[]} */
    const releases = status.releases.filter(
      (/** @type {{type:string}} */ entry) => entry.type !== "none",
    );
    for (const entry of releases)
      assert(names.has(entry.name), `NON_PUBLIC_VERSION_INTENT: ${entry.name}`);
    await validateAllocations(releases, readVersions, channel);
    run(["exec", "changeset", "version"]);
    run(["install", "--lockfile-only", "--ignore-scripts", "--no-frozen-lockfile"]);
    const packages = entries
      .map((entry) => {
        const manifest = readManifest(entry.path);
        const planned = releases.find((item) => item.name === entry.name);
        if (planned)
          assert.equal(
            manifest.version,
            planned.newVersion,
            `VERSION_PLAN_MISMATCH: ${entry.name}`,
          );
        return { name: manifest.name, version: manifest.version };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    assert(
      channel !== "latest" || packages.every((pkg) => prerelease(pkg.version) === null),
      "STABLE_VERSION_REQUIRED",
    );
    writeFileSync(
      resolve(root, "release-intent.json"),
      `${JSON.stringify({ schema: 1, channel, packages }, null, 2)}\n`,
    );
    run([
      "exec",
      "vp",
      "fmt",
      ...(existsSync(prePath) ? [".changeset/pre.json"] : []),
      "release-intent.json",
      ...entries
        .flatMap((entry) => [join(entry.path, "package.json"), join(entry.path, "CHANGELOG.md")])
        .filter(existsSync),
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await versionRelease();

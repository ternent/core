import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { gateNames, integrity, packageNames, sha256, writeJson } from "./shared.mjs";

export const sourceSha = "1".repeat(40);
export const now = new Date("2026-11-21T12:00:00.000Z");
/** @param {{intent?:boolean,edit?:(manifest:any)=>void,privatePackage?:boolean}} [options] */
export function fixture(options = {}) {
  const root = mkdtempSync(join(tmpdir(), "ternent-release-test-"));
  mkdirSync(join(root, "artifacts/candidates"), { recursive: true });
  writeJson(join(root, "package.json"), {
    name: "test-root",
    private: true,
    packageManager: "pnpm@12.21.0",
  });
  writeFileSync(join(root, "pnpm-lock.yaml"), "fixture lockfile\n");
  const versions = Object.fromEntries(packageNames.map((name) => [name, "1.0.0-alpha.0"]));
  const dependencies = {
    "@ternent/identity": {},
    "@ternent/armour": { "@ternent/identity": "^1.0.0-alpha.0" },
    "@ternent/ledger": { "@ternent/identity": "^1.0.0-alpha.0" },
    "@ternent/concord": {
      "@ternent/identity": "^1.0.0-alpha.0",
      "@ternent/armour": "^1.0.0-alpha.0",
      "@ternent/ledger": "^1.0.0-alpha.0",
    },
    "@ternent/seal": { "@ternent/identity": "^1.0.0-alpha.0", "@ternent/armour": "^1.0.0-alpha.0" },
  };
  /** @type {{name:string,path:string}[]} */ const inventory = [];
  /** @type {Record<string,any>} */ const candidates = {};
  for (const name of packageNames) {
    const path = join(root, "packages", name.split("/")[1]);
    mkdirSync(join(path, "package"), { recursive: true });
    const manifest = {
      name,
      version: versions[name],
      repository: {
        type: "git",
        url: "git+https://github.com/ternent/core.git",
        directory: `packages/${name.split("/")[1]}`,
      },
      type: "module",
      publishConfig: { access: "public" },
      dependencies: dependencies[/** @type {keyof typeof dependencies} */ (name)],
    };
    options.edit?.(manifest);
    writeJson(join(path, "package.json"), manifest);
    writeJson(join(path, "package/package.json"), manifest);
    writeFileSync(
      join(path, "package/index.js"),
      `export const marker = ${JSON.stringify(name)};\n`,
    );
    inventory.push({ name, path });
    const file = join(root, "artifacts/candidates", `${name.slice(1).replace("/", "-")}.tgz`);
    execFileSync("tar", ["-czf", file, "-C", path, "package"]);
    const bytes = readFileSync(file);
    candidates[name] = {
      file,
      version: manifest.version,
      sha256: sha256(bytes),
      integrity: integrity(bytes),
    };
  }
  if (options.privatePackage) {
    const path = join(root, "private");
    mkdirSync(path);
    writeJson(join(path, "package.json"), {
      name: "@ternent/private",
      version: "1.0.0",
      private: true,
    });
    inventory.push({ name: "@ternent/private", path });
  }
  const intent = {
    schema: 1,
    channel: "next",
    packages: packageNames.map((name) => ({ name, version: versions[name] })),
  };
  if (options.intent !== false) writeJson(join(root, "release-intent.json"), intent);
  writeJson(join(root, "artifacts/check.json"), {
    sourceSha,
    scope: "active-workspace",
    node: "v26.13.1",
    gates: gateNames.map((gate) => ({ gate, exitCode: 0, seconds: 1 })),
  });
  writeJson(join(root, "artifacts/consumers.json"), {
    sourceSha,
    candidates,
    checks: ["fixture gates passed"],
  });
  const directory = join(root, "bundle");
  const planOptions = {
    root,
    directory,
    inventory,
    sourceSha,
    previousVersions: versions,
    now,
    toolchain: { node: "v26.13.1", pnpm: "12.21.0", npm: "11.14.0" },
  };
  return { root, directory, inventory, versions, candidates, intent, planOptions };
}

/** @param {import('./shared.mjs').ReleasePlan} plan */
export function registryFixture(plan) {
  /** @type {Map<string,string>} */ const versions = new Map();
  /** @type {Map<string,string>} */ const tags = new Map(
    plan.packages.map((pkg) => [pkg.name, "0.9.0"]),
  );
  /** @type {any[]} */ const calls = [];
  /** @type {import('./publish.mjs').RegistryAdapter} */
  const registry = {
    async getVersion(name, version) {
      calls.push(["getVersion", name, version]);
      const value = versions.get(`${name}@${version}`);
      return value ? { integrity: value } : null;
    },
    async getTag(name, tag) {
      calls.push(["getTag", name, tag]);
      return tags.get(name) ?? null;
    },
    async publish(pkg, file, tag) {
      calls.push(["publish", pkg.name, file, tag]);
      versions.set(`${pkg.name}@${pkg.version}`, pkg.integrity);
    },
    async setTag(name, version, tag) {
      calls.push(["setTag", name, version, tag]);
      tags.set(name, version);
    },
    async removeTag(name, tag) {
      calls.push(["removeTag", name, tag]);
      tags.delete(name);
    },
  };
  return { versions, tags, calls, registry };
}

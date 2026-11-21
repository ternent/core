import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  lstatSync,
  readFileSync,
  realpathSync,
  renameSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import canonicalize from "canonicalize";
import semver from "semver";

/** @typedef {{name:string, version:string}} Dependency */
/** @typedef {Dependency & {tarball:string,sha256:string,integrity:string,dependencies:Dependency[]}} ReleasePackage */
/** @typedef {{schema:1,sourceSha:string,lockfileSha256:string,intentSha256:string|null,channel:'next',createdAt:string,expiresAt:string,toolchain:Record<string,string>,packages:ReleasePackage[],reports:{path:string,sha256:string}[],releaseId:string}} ReleasePlan */
export const packageNames = Object.freeze([
  "@ternent/identity",
  "@ternent/armour",
  "@ternent/ledger",
  "@ternent/concord",
  "@ternent/seal",
]);
export const gateNames = Object.freeze([
  "contract",
  "format",
  "build",
  "lint",
  "types:root",
  "types:workspace",
  "behavior",
  "release",
  "consumers",
]);
export const retentionMs = 7 * 24 * 60 * 60 * 1000;
export const registryUrl = "https://registry.npmjs.org/";
export class ReleaseError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = "ReleaseError";
    this.code = code;
    this.phase = "release";
    /** @type {string|undefined} */ this.sourceSha = undefined;
    /** @type {string|undefined} */ this.releaseId = undefined;
    this.retryable = [
      "REGISTRY_UNAVAILABLE",
      "PUBLISH_PARTIAL",
      "PROMOTION_PARTIAL",
      "CONSUMER_FAILED",
    ].includes(code);
  }
}
/** @param {unknown} condition @param {string} code @param {string} message @returns {asserts condition} */
export function requireThat(condition, code, message) {
  if (!condition) throw new ReleaseError(code, message);
}
/** @param {unknown} value @param {string[]} keys @returns {asserts value is Record<string,any>} */
export function closed(value, keys) {
  requireThat(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      Object.keys(value).sort().join("\0") === [...keys].sort().join("\0"),
    "PLAN_INVALID",
    "Unexpected record shape",
  );
}
/** @param {string|Uint8Array} bytes */
export function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}
/** @param {Uint8Array} bytes */
export function integrity(bytes) {
  return `sha512-${createHash("sha512").update(bytes).digest("base64")}`;
}
/** @param {unknown} value */
export function jcs(value) {
  const text = canonicalize(value);
  requireThat(typeof text === "string", "PLAN_INVALID", "Cannot canonicalize plan");
  return text;
}
/** @param {Omit<ReleasePlan,'releaseId'> | ReleasePlan} plan */
export function releaseId(plan) {
  const { releaseId: _id, ...subject } = /** @type {ReleasePlan} */ (plan);
  return sha256(jcs(subject));
}
/** @param {string} directory @param {string} path */
export function artifactPath(directory, path) {
  requireThat(
    typeof path === "string" &&
      !isAbsolute(path) &&
      /^[A-Za-z0-9._/-]+$/.test(path) &&
      path.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
    "PATH_INVALID",
    "Artifact path must be portable and relative",
  );
  const full = resolve(directory, path);
  let stat, actual, root;
  try {
    stat = lstatSync(full);
    actual = realpathSync(full);
    root = realpathSync(directory);
  } catch {
    throw new ReleaseError("ARTIFACT_MISSING", `Missing artifact: ${path}`);
  }
  requireThat(
    stat.isFile() &&
      !stat.isSymbolicLink() &&
      !relative(root, actual).startsWith("..") &&
      !isAbsolute(relative(root, actual)),
    "PATH_INVALID",
    `Artifact escapes bundle: ${path}`,
  );
  return full;
}
/** @param {string} path */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ReleaseError("PLAN_INVALID", `Cannot read JSON: ${path}`);
  }
}
/** @param {string} path @param {unknown} value */
export function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}
/** @param {string} tarball */
export function packedManifest(tarball) {
  try {
    return JSON.parse(
      execFileSync("tar", ["-xOf", tarball, "package/package.json"], {
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      }),
    );
  } catch {
    throw new ReleaseError("CONTRACT_INVALID", "Cannot read packed manifest");
  }
}
/** @param {any} manifest @param {Map<string,string>} versions */
export function validateManifest(manifest, versions) {
  requireThat(
    manifest &&
      packageNames.includes(manifest.name) &&
      versions.get(manifest.name) === manifest.version &&
      semver.valid(manifest.version) === manifest.version &&
      !manifest.private &&
      manifest.type === "module" &&
      manifest.publishConfig?.access === "public" &&
      !manifest.publishConfig.registry,
    "CONTRACT_INVALID",
    "Invalid public package metadata",
  );
  for (const hook of [
    "prepare",
    "prepack",
    "postpack",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
  ])
    requireThat(
      !Object.hasOwn(manifest.scripts ?? {}, hook),
      "CONTRACT_INVALID",
      `Forbidden lifecycle: ${hook}`,
    );
  /** @type {Map<string,string>} */ const dependencies = new Map();
  for (const kind of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    for (const [name, range] of Object.entries(manifest[kind] ?? {})) {
      requireThat(
        typeof range === "string" && !/^(workspace:|file:|link:)/.test(range),
        "CONTRACT_INVALID",
        "Unresolved local dependency in packed manifest",
      );
      if (versions.has(name)) {
        const version = /** @type {string} */ (versions.get(name));
        requireThat(
          semver.satisfies(version, range),
          "CONTRACT_INVALID",
          `Unsatisfied sibling range: ${manifest.name} -> ${name}`,
        );
        dependencies.set(name, version);
      }
    }
  }
  return [...dependencies]
    .map(([name, version]) => ({ name, version }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
/** @param {ReleasePackage[]} packages */
export function orderedPackages(packages) {
  const byName = new Map(packages.map((pkg) => [pkg.name, pkg]));
  /** @type {Set<string>} */ const active = new Set(),
    done = new Set();
  /** @type {ReleasePackage[]} */ const result = [];
  /** @param {string} name */
  function visit(name) {
    requireThat(!active.has(name), "CONTRACT_INVALID", "Cyclic release dependencies");
    if (done.has(name)) return;
    const pkg = byName.get(name);
    requireThat(pkg, "PLAN_INVALID", "Missing release dependency");
    active.add(name);
    for (const dependency of pkg.dependencies) visit(dependency.name);
    active.delete(name);
    done.add(name);
    result.push(pkg);
  }
  for (const name of [...byName.keys()].sort()) visit(name);
  return result;
}

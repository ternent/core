import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { workspacePackages } from "../verify/workspace.mjs";
import {
  artifactPath,
  closed,
  gateNames,
  integrity,
  jcs,
  orderedPackages,
  packageNames,
  packedManifest,
  readJson,
  releaseId,
  requireThat,
  retentionMs,
  sha256,
  validateManifest,
} from "./shared.mjs";

/** @typedef {import('./shared.mjs').ReleasePlan} ReleasePlan */
/** @typedef {import('./shared.mjs').ReleasePackage} ReleasePackage */
/** @param {any} intent */
function validateIntent(intent) {
  closed(intent, ["schema", "channel", "packages"]);
  requireThat(
    intent.schema === 1 && intent.channel === "next" && Array.isArray(intent.packages),
    "PLAN_INVALID",
    "Invalid release intent",
  );
  for (const pkg of intent.packages) {
    closed(pkg, ["name", "version"]);
    requireThat(typeof pkg.version === "string", "PLAN_INVALID", "Invalid intended version");
  }
  requireThat(
    jcs(intent.packages.map((pkg) => pkg.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))) ===
      jcs([...packageNames].sort()),
    "PLAN_INVALID",
    "Release intent must describe exactly five libraries",
  );
  return new Map(intent.packages.map((pkg) => [pkg.name, pkg.version]));
}
/** @param {any} check @param {any} consumer @param {string} sourceSha */
function validateReports(check, consumer, sourceSha) {
  requireThat(
    check?.sourceSha === sourceSha && consumer?.sourceSha === sourceSha,
    "GATE_FAILED",
    "Reports do not bind this source revision",
  );
  const gates = /** @type {{gate:string,exitCode:number}[]} */ (check.gates);
  requireThat(
    check.scope === "active-workspace" &&
      Array.isArray(gates) &&
      gates.length === gateNames.length &&
      jcs(gates.map((gate) => gate.gate).sort()) === jcs([...gateNames].sort()) &&
      gates.every((gate) => gate.exitCode === 0),
    "GATE_FAILED",
    "Complete successful acceptance is required",
  );
  requireThat(
    !consumer.error &&
      Array.isArray(consumer.checks) &&
      consumer.checks.length > 0 &&
      consumer.candidates &&
      jcs(Object.keys(consumer.candidates).sort()) === jcs([...packageNames].sort()),
    "GATE_FAILED",
    "Five-library consumer acceptance is required",
  );
}
/** @param {string} name @param {string} version */
function tarballName(name, version) {
  return `candidates/${name.slice(1).replace("/", "-")}-${version}.tgz`;
}

/**
 * Freeze the accepted artifacts into a portable bundle without repacking.
 * @param {{root:string,directory:string,sourceSha?:string,previousVersions?:Record<string,string>,inventory?:{name:string,path:string}[],now?:Date,toolchain?:Record<string,string>}} options
 */
export function createPlan(options) {
  const root = resolve(options.root),
    directory = resolve(options.directory);
  const sourceSha =
    options.sourceSha ??
    process.env.GITHUB_SHA ??
    execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
  const inventory = options.inventory ?? workspacePackages(root);
  const manifests = inventory
    .map(({ path }) => ({ path, manifest: readJson(join(path, "package.json")) }))
    .filter(({ manifest }) => !manifest.private);
  requireThat(
    jcs(
      manifests.map(({ manifest }) => manifest.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    ) === jcs([...packageNames].sort()),
    "CONTRACT_INVALID",
    "Exactly five public libraries are required",
  );
  const versions = new Map(manifests.map(({ manifest }) => [manifest.name, manifest.version]));
  const intentPath = join(root, "release-intent.json");
  const hasIntent = existsSync(intentPath);
  if (!hasIntent) {
    const previous =
      options.previousVersions ??
      Object.fromEntries(
        manifests.map(({ path, manifest }) => {
          try {
            const old = JSON.parse(
              execFileSync("git", ["show", `HEAD^:${relative(root, join(path, "package.json"))}`], {
                cwd: root,
                encoding: "utf8",
                stdio: ["ignore", "pipe", "ignore"],
              }),
            );
            return [manifest.name, old.version];
          } catch {
            return [manifest.name, null];
          }
        }),
      );
    requireThat(
      manifests.every(({ manifest }) => previous[manifest.name] === manifest.version),
      "INTENT_MISSING",
      "A new public version requires committed release intent",
    );
  } else {
    const intended = validateIntent(readJson(artifactPath(root, "release-intent.json")));
    requireThat(
      [...versions].every(([name, version]) => intended.get(name) === version),
      "PLAN_INVALID",
      "Release intent disagrees with current versions",
    );
  }
  const checkPath = artifactPath(root, "artifacts/check.json"),
    consumerPath = artifactPath(root, "artifacts/consumers.json");
  const check = readJson(checkPath),
    consumer = readJson(consumerPath);
  validateReports(check, consumer, sourceSha);
  const now = options.now ?? new Date();
  /** @type {ReleasePackage[]} */ const candidates = [];
  for (const { manifest } of manifests) {
    const accepted = consumer.candidates[manifest.name];
    requireThat(
      accepted.version === manifest.version,
      "GATE_FAILED",
      "Consumer tested a different version",
    );
    const source = artifactPath(root, relative(root, accepted.file));
    const bytes = readFileSync(source);
    requireThat(
      sha256(bytes) === accepted.sha256 && integrity(bytes) === accepted.integrity,
      "DIGEST_MISMATCH",
      "Accepted candidate bytes changed",
    );
    const dependencies = validateManifest(packedManifest(source), versions);
    // The source metadata must agree with the packed runtime ranges after workspace rewriting.
    const packed = packedManifest(source);
    for (const kind of ["dependencies", "optionalDependencies", "peerDependencies"]) {
      const declared = manifest[kind] ?? {},
        actual = packed[kind] ?? {};
      requireThat(
        jcs(Object.keys(declared).sort()) === jcs(Object.keys(actual).sort()),
        "CONTRACT_INVALID",
        "Packed dependency inventory changed",
      );
      for (const [name, range] of Object.entries(declared))
        requireThat(
          typeof range === "string" &&
            (range.startsWith("workspace:") ? versions.has(name) : range === actual[name]),
          "CONTRACT_INVALID",
          "Packed dependency metadata changed",
        );
    }
    candidates.push({
      name: manifest.name,
      version: manifest.version,
      tarball: tarballName(manifest.name, manifest.version),
      sha256: accepted.sha256,
      integrity: accepted.integrity,
      dependencies,
    });
  }
  /** @type {Omit<ReleasePlan,'releaseId'>} */
  const subject = {
    schema: 1,
    sourceSha,
    lockfileSha256: sha256(readFileSync(join(root, "pnpm-lock.yaml"))),
    intentSha256: hasIntent ? sha256(readFileSync(intentPath)) : null,
    channel: "next",
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + retentionMs).toISOString(),
    toolchain: options.toolchain ?? {
      node: process.version,
      pnpm: readJson(join(root, "package.json")).packageManager,
      npm: execFileSync("npm", ["--version"], { encoding: "utf8" }).trim(),
      ...readJson(join(root, "package.json")).devDependencies,
    },
    packages: hasIntent ? orderedPackages(candidates) : [],
    reports: [
      { path: "reports/check.json", sha256: sha256(readFileSync(checkPath)) },
      { path: "reports/consumers.json", sha256: sha256(readFileSync(consumerPath)) },
    ],
  };
  /** @type {ReleasePlan} */ const plan = { ...subject, releaseId: releaseId(subject) };
  requireThat(!existsSync(directory), "ARTIFACT_EXISTS", "Release bundle already exists");
  mkdirSync(dirname(directory), { recursive: true });
  const staging = mkdtempSync(join(dirname(directory), `.${basename(directory)}-`));
  try {
    for (const candidate of candidates) {
      const target = join(staging, candidate.tarball);
      mkdirSync(dirname(target), { recursive: true });
      copyFileSync(consumer.candidates[candidate.name].file, target);
    }
    mkdirSync(join(staging, "reports"));
    copyFileSync(checkPath, join(staging, "reports/check.json"));
    copyFileSync(consumerPath, join(staging, "reports/consumers.json"));
    if (hasIntent) copyFileSync(intentPath, join(staging, "release-intent.json"));
    writeFileSync(join(staging, "release-plan.json"), `${jcs(plan)}\n`);
    validatePlan(plan, { directory: staging, expectedSourceSha: sourceSha, now });
    renameSync(staging, directory);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { status: hasIntent ? "planned" : "noop", plan };
}

/** @param {unknown} input @param {{directory:string,expectedSourceSha?:string,now?:Date}} options @returns {ReleasePlan} */
export function validatePlan(input, options) {
  closed(input, [
    "schema",
    "sourceSha",
    "lockfileSha256",
    "intentSha256",
    "channel",
    "createdAt",
    "expiresAt",
    "toolchain",
    "packages",
    "reports",
    "releaseId",
  ]);
  const plan = /** @type {ReleasePlan} */ (input);
  requireThat(
    plan.schema === 1 &&
      plan.channel === "next" &&
      /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(plan.sourceSha) &&
      /^[0-9a-f]{64}$/.test(plan.lockfileSha256) &&
      /^[0-9a-f]{64}$/.test(plan.releaseId) &&
      releaseId(plan) === plan.releaseId,
    "PLAN_INVALID",
    "Invalid release identity",
  );
  if (options.expectedSourceSha)
    requireThat(
      plan.sourceSha === options.expectedSourceSha,
      "PLAN_INVALID",
      "Wrong source revision",
    );
  const created = Date.parse(plan.createdAt),
    expires = Date.parse(plan.expiresAt),
    now = (options.now ?? new Date()).getTime();
  requireThat(
    Number.isFinite(created) &&
      Number.isFinite(expires) &&
      new Date(created).toISOString() === plan.createdAt &&
      new Date(expires).toISOString() === plan.expiresAt &&
      expires - created === retentionMs &&
      created <= now + 300_000 &&
      now < expires,
    "ARTIFACT_EXPIRED",
    "Release artifact retention window is invalid or expired",
  );
  requireThat(
    plan.toolchain &&
      typeof plan.toolchain === "object" &&
      !Array.isArray(plan.toolchain) &&
      ["node", "pnpm", "npm"].every(
        (key) => typeof plan.toolchain[key] === "string" && plan.toolchain[key].length > 0,
      ) &&
      Object.values(plan.toolchain).every((value) => typeof value === "string" && value.length > 0),
    "PLAN_INVALID",
    "Invalid toolchain record",
  );
  requireThat(
    Array.isArray(plan.packages) && Array.isArray(plan.reports),
    "PLAN_INVALID",
    "Invalid plan artifacts",
  );
  for (const report of plan.reports) {
    closed(report, ["path", "sha256"]);
    requireThat(
      /^[0-9a-f]{64}$/.test(report.sha256) &&
        sha256(readFileSync(artifactPath(options.directory, report.path))) === report.sha256,
      "DIGEST_MISMATCH",
      "Gate report changed",
    );
  }
  requireThat(
    jcs(plan.reports.map((report) => report.path).sort()) ===
      jcs(["reports/check.json", "reports/consumers.json"]),
    "PLAN_INVALID",
    "Invalid report inventory",
  );
  const check = readJson(artifactPath(options.directory, "reports/check.json")),
    consumer = readJson(artifactPath(options.directory, "reports/consumers.json"));
  validateReports(check, consumer, plan.sourceSha);
  const versions = new Map(packageNames.map((name) => [name, consumer.candidates[name].version]));
  /** @type {ReleasePackage[]} */ const candidates = [];
  for (const name of packageNames) {
    const accepted = consumer.candidates[name];
    const tarball = tarballName(name, accepted.version),
      bytes = readFileSync(artifactPath(options.directory, tarball));
    requireThat(
      sha256(bytes) === accepted.sha256 && integrity(bytes) === accepted.integrity,
      "DIGEST_MISMATCH",
      "Candidate digest changed",
    );
    candidates.push({
      name,
      version: accepted.version,
      tarball,
      sha256: accepted.sha256,
      integrity: accepted.integrity,
      dependencies: validateManifest(
        packedManifest(artifactPath(options.directory, tarball)),
        versions,
      ),
    });
  }
  if (plan.packages.length === 0)
    requireThat(plan.intentSha256 === null, "PLAN_INVALID", "No-op plan has release intent");
  else {
    requireThat(
      typeof plan.intentSha256 === "string" && /^[0-9a-f]{64}$/.test(plan.intentSha256),
      "PLAN_INVALID",
      "Publication requires release intent",
    );
    const intent = artifactPath(options.directory, "release-intent.json");
    requireThat(
      sha256(readFileSync(intent)) === plan.intentSha256,
      "DIGEST_MISMATCH",
      "Release intent changed",
    );
    const intended = validateIntent(readJson(intent));
    requireThat(
      [...versions].every(([name, version]) => intended.get(name) === version),
      "PLAN_INVALID",
      "Intent versions disagree with candidates",
    );
    for (const pkg of plan.packages) {
      closed(pkg, ["name", "version", "tarball", "sha256", "integrity", "dependencies"]);
      artifactPath(options.directory, pkg.tarball);
    }
    requireThat(
      jcs(plan.packages) === jcs(orderedPackages(candidates)),
      "PLAN_INVALID",
      "Release packages, digests or dependency order changed",
    );
  }
  return plan;
}

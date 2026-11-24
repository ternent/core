import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, isAbsolute } from "node:path";
import { createPlan, validatePlan } from "./plan.mjs";
import { fixture, now } from "./fixtures.mjs";
import { jcs, packageNames, readJson, releaseId, sha256, writeJson } from "./shared.mjs";

/** @param {import('node:test').TestContext} t @param {Parameters<typeof fixture>[0]} [options] */
function setup(t, options) {
  const f = fixture(options);
  t.after(() => rmSync(f.root, { recursive: true, force: true }));
  return f;
}
/** @param {string} code @returns {(error:any)=>boolean} */
const error = (code) => (e) => e.code === code;

await test("planner freezes all five exact bytes, orders dependencies and binds reports/intent with JCS", (t) => {
  const f = setup(t, { privatePackage: true });
  const { status, plan } = createPlan(f.planOptions);
  assert.equal(status, "planned");
  assert.deepEqual(
    plan.packages.map((pkg) => pkg.name),
    packageNames,
  );
  assert.equal(plan.intentSha256, sha256(readFileSync(join(f.root, "release-intent.json"))));
  assert.equal(
    new Date(plan.expiresAt).getTime() - new Date(plan.createdAt).getTime(),
    7 * 86400000,
  );
  for (const pkg of plan.packages) {
    assert(!isAbsolute(pkg.tarball));
    assert.deepEqual(
      readFileSync(join(f.directory, pkg.tarball)),
      readFileSync(f.candidates[pkg.name].file),
    );
  }
  assert.equal(validatePlan(plan, { directory: f.directory, now }).releaseId, plan.releaseId);
  assert.equal(
    releaseId(/** @type {typeof plan} */ (Object.fromEntries(Object.entries(plan).reverse()))),
    plan.releaseId,
  );
  assert(!JSON.stringify(plan).includes("@ternent/private"));
});

await test("no intent is an explicit no-op while the signed bundle still carries all five candidates", (t) => {
  const f = setup(t, { intent: false });
  const { status, plan } = createPlan(f.planOptions);
  assert.equal(status, "noop");
  assert.deepEqual(plan.packages, []);
  assert.equal(plan.intentSha256, null);
  for (const [name, candidate] of Object.entries(f.candidates))
    assert(
      existsSync(
        join(f.directory, `candidates/${name.slice(1).replace("/", "-")}-${candidate.version}.tgz`),
      ),
    );
  validatePlan(plan, { directory: f.directory, now });
});

await test("new public version without intent fails rather than silently skipping", (t) => {
  const f = setup(t, { intent: false });
  assert.throws(
    () =>
      createPlan({
        ...f.planOptions,
        previousVersions: { ...f.versions, "@ternent/identity": "0.9.0" },
      }),
    error("INTENT_MISSING"),
  );
  assert(!existsSync(f.directory));
});

await test("intent must be the closed five-library version snapshot", (t) => {
  const f = setup(t);
  const path = join(f.root, "release-intent.json");
  for (const intent of [
    { ...f.intent, extra: true },
    { ...f.intent, channel: "latest" },
    { ...f.intent, packages: f.intent.packages.slice(1) },
    { ...f.intent, packages: [...f.intent.packages.slice(1), f.intent.packages[1]] },
    { ...f.intent, packages: f.intent.packages.map((pkg) => ({ ...pkg, version: "9.0.0" })) },
  ]) {
    writeJson(path, intent);
    assert.throws(() => createPlan(f.planOptions), error("PLAN_INVALID"));
  }
});

await test("stable plans bind latest to stable candidates and reject a channel changed independently of intent", (t) => {
  const f = setup(t, { channel: "latest" });
  const { plan } = createPlan(f.planOptions);
  assert.equal(plan.channel, "latest");
  assert(plan.packages.every((pkg) => pkg.version === "1.0.0"));
  validatePlan(plan, { directory: f.directory, now });
  const changed = { ...plan, channel: /** @type {const} */ ("next") };
  changed.releaseId = releaseId(changed);
  assert.throws(() => validatePlan(changed, { directory: f.directory, now }), error("PLAN_INVALID"));
});

await test("incomplete, failed and stale-source acceptance cannot produce a bundle", (t) => {
  const f = setup(t);
  const path = join(f.root, "artifacts/check.json"),
    good = readJson(path);
  for (const check of [
    { ...good, gates: good.gates.slice(1) },
    {
      ...good,
      gates: /** @type {{gate:string,exitCode:number}[]} */ (good.gates).map((gate) => ({
        ...gate,
        exitCode: 1,
      })),
    },
    { ...good, sourceSha: "2".repeat(40) },
  ]) {
    writeJson(path, check);
    assert.throws(() => createPlan(f.planOptions), error("GATE_FAILED"));
  }
  writeJson(path, good);
  const consumer = join(f.root, "artifacts/consumers.json");
  writeJson(consumer, { ...readJson(consumer), error: "browser failed" });
  assert.throws(() => createPlan(f.planOptions), error("GATE_FAILED"));
});

await test("public eligibility, lifecycle and packed sibling ranges are enforced", (t) => {
  /** @type {((manifest:any)=>void)[]} */
  const edits = [
    (m) => {
      if (m.name === "@ternent/identity") m.private = true;
    },
    (m) => {
      if (m.name === "@ternent/identity") m.scripts = { prepare: "echo forbidden" };
    },
    (m) => {
      if (m.name === "@ternent/armour") m.dependencies["@ternent/identity"] = "^9.0.0";
    },
  ];
  for (const edit of edits) {
    const f = setup(t, { edit });
    assert.throws(() => createPlan(f.planOptions), error("CONTRACT_INVALID"));
  }
});

await test("planner rejects missing or mismatched packed provenance repositories before publication", (t) => {
  for (const repository of [
    undefined,
    { type: "git", url: "git+https://github.com/samternent/home.git" },
    { type: "git", url: "git+https://github.com/Ternent/core.git" },
  ]) {
    const f = setup(t, {
      edit: (manifest) => {
        if (manifest.name === "@ternent/concord") manifest.repository = repository;
      },
    });
    assert.throws(() => createPlan(f.planOptions), error("CONTRACT_INVALID"));
    assert(!existsSync(f.directory));
  }
});

await test("tarball/report/intent tampering and escaped or symlinked bundle paths fail", (t) => {
  for (const kind of ["tarball", "report", "intent", "escape", "symlink"]) {
    const f = setup(t);
    const { plan } = createPlan(f.planOptions);
    if (kind === "tarball") writeFileSync(join(f.directory, plan.packages[0].tarball), "changed");
    if (kind === "report") writeFileSync(join(f.directory, plan.reports[0].path), "{}");
    if (kind === "intent") writeFileSync(join(f.directory, "release-intent.json"), "{}");
    if (kind === "escape") {
      plan.packages[0].tarball = "../../escape.tgz";
      plan.releaseId = releaseId(plan);
    }
    if (kind === "symlink") {
      const file = join(f.directory, plan.packages[0].tarball);
      rmSync(file);
      symlinkSync(f.candidates[plan.packages[0].name].file, file);
    }
    assert.throws(
      () => validatePlan(plan, { directory: f.directory, now }),
      error(kind === "escape" || kind === "symlink" ? "PATH_INVALID" : "DIGEST_MISMATCH"),
    );
  }
});

await test("missing/expired/mismatched/reordered plans fail before any publishing", (t) => {
  const f = setup(t);
  const { plan } = createPlan(f.planOptions);
  assert.throws(() => validatePlan({}, { directory: f.directory, now }), error("PLAN_INVALID"));
  assert.throws(
    () => validatePlan(plan, { directory: f.directory, now: new Date(plan.expiresAt) }),
    error("ARTIFACT_EXPIRED"),
  );
  assert.throws(
    () => validatePlan(plan, { directory: f.directory, now, expectedSourceSha: "2".repeat(40) }),
    error("PLAN_INVALID"),
  );
  const reversed = { ...plan, packages: [...plan.packages].reverse() };
  reversed.releaseId = releaseId(reversed);
  assert.throws(
    () => validatePlan(reversed, { directory: f.directory, now }),
    error("PLAN_INVALID"),
  );
  const missing = { ...plan, releaseId: "f".repeat(64) };
  assert.throws(
    () => validatePlan(missing, { directory: f.directory, now }),
    error("PLAN_INVALID"),
  );
  assert.equal(
    jcs(JSON.parse(readFileSync(join(f.directory, "release-plan.json"), "utf8"))),
    jcs(plan),
  );
});

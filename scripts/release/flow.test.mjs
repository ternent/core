import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import {
  captureTools,
  extractArtifact,
  restoreTools,
  selectRelease,
  stageRelease,
} from "./flow.mjs";
import { packageNames, sha256 } from "./shared.mjs";

const sourceSha = "1".repeat(40),
  parentSha = "2".repeat(40),
  workflowSha = "3".repeat(40),
  releaseId = "a".repeat(64);
const rootApi = "repos/ternent/core";
const intent = {
  encoding: "base64",
  content: Buffer.from(
    JSON.stringify({
      schema: 1,
      channel: "next",
      packages: packageNames.map((name) => ({ name, version: "1.0.0-alpha.0" })),
    }),
  ).toString("base64"),
};
/** @param {any} value */
const copy = (value) => JSON.parse(JSON.stringify(value));
/** @param {string} file @param {string|Uint8Array} value */
function put(file, value) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}
/** @param {import('node:test').TestContext} t */
function temporary(t) {
  const dir = mkdtempSync(join(tmpdir(), "ternent-flow-test-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}
/** @param {string} path @param {string} text */
const entry = (path, text) => [path, strToU8(text)];
function producerArchive() {
  const plan = {
    sourceSha,
    releaseId,
    intentSha256: "b".repeat(64),
    packages: packageNames.map((name) => ({ name })),
  };
  return zipSync(
    Object.fromEntries([
      entry("release/release-plan.json", JSON.stringify(plan)),
      entry("release/release-proof.json", "producer proof"),
      entry("release/candidates/candidate.tgz", "immutable candidate"),
      ...["identity", "armour", "seal"].map((name) =>
        entry(`release/tools/packages/${name}/dist/index.js`, "export const verified = true;"),
      ),
    ]),
  );
}
/** @param {Uint8Array} [archive] */
function responses(archive = producerArchive()) {
  /** @type {Record<string,any>} */
  const values = {
    [`${rootApi}/actions/runs/10`]: {
      id: 10,
      workflow_id: 7,
      path: ".github/workflows/ci.yml",
      repository: { full_name: "ternent/core" },
      head_repository: { full_name: "ternent/core" },
      head_branch: "main",
      head_sha: sourceSha,
      event: "push",
      status: "completed",
      conclusion: "success",
      run_started_at: "2026-11-21T12:00:00Z",
    },
    [`${rootApi}/actions/workflows/ci.yml`]: { id: 7 },
    [`${rootApi}/compare/${sourceSha}...main`]: { status: "ahead" },
    [`${rootApi}/contents/release-intent.json?ref=${sourceSha}`]: copy(intent),
    [`${rootApi}/git/commits/${sourceSha}`]: { parents: [{ sha: parentSha }] },
    [`${rootApi}/contents/release-intent.json?ref=${parentSha}`]: null,
    [`${rootApi}/actions/runs/10/artifacts?per_page=100`]: {
      artifacts: [
        {
          id: 20,
          name: "core-evidence",
          expired: false,
          digest: `sha256:${sha256(archive)}`,
          size_in_bytes: archive.length,
          created_at: "2026-11-21T12:02:00Z",
          workflow_run: { id: 10, head_sha: sourceSha },
        },
      ],
    },
  };
  /** @param {string} path */
  async function api(path) {
    assert(Object.hasOwn(values, path), `Unexpected API request ${path}`);
    return copy(values[path]);
  }
  return { values, api };
}

await test("selection binds the exact successful main push, workflow and retained artifact", async () => {
  const f = responses();
  const result = await selectRelease({ runId: "10", api: f.api, requestedReleaseId: releaseId });
  assert.equal(result.status, "selected");
  assert.deepEqual(result.selection, {
    sourceSha,
    runId: 10,
    artifactId: 20,
    artifactDigest:
      f.values[`${rootApi}/actions/runs/10/artifacts?per_page=100`].artifacts[0].digest,
    requestedReleaseId: releaseId,
  });
  await assert.rejects(() => selectRelease({ runId: "10; injected", api: f.api }), /identifier/);
  await assert.rejects(
    () => selectRelease({ runId: 10, api: f.api, requestedReleaseId: "latest" }),
    /release ID/,
  );
});

for (const [label, mutate] of /** @type {[string,(value:any)=>void][]} */ ([
  ["PR evidence", (run) => (run.event = "pull_request")],
  ["fork producer", (run) => (run.head_repository.full_name = "fork/core")],
  ["other branch", (run) => (run.head_branch = "feature")],
  ["other workflow path", (run) => (run.path = ".github/workflows/other.yml")],
  ["other workflow identity", (run) => (run.workflow_id = 8)],
  ["failed verification", (run) => (run.conclusion = "failure")],
  ["unfinished verification", (run) => (run.status = "in_progress")],
]))
  await test(`selection rejects ${label}`, async () => {
    const f = responses();
    mutate(f.values[`${rootApi}/actions/runs/10`]);
    await assert.rejects(() => selectRelease({ runId: 10, api: f.api }));
  });

await test("missing/unchanged intent is a no-op; private selection is rejected", async () => {
  const f = responses();
  f.values[`${rootApi}/contents/release-intent.json?ref=${sourceSha}`] = null;
  assert.equal((await selectRelease({ runId: 10, api: f.api })).status, "noop");
  f.values[`${rootApi}/contents/release-intent.json?ref=${sourceSha}`] = copy(intent);
  f.values[`${rootApi}/contents/release-intent.json?ref=${parentSha}`] = copy(intent);
  assert.equal((await selectRelease({ runId: 10, api: f.api })).status, "noop");
  f.values[`${rootApi}/contents/release-intent.json?ref=${parentSha}`] = null;
  f.values[`${rootApi}/contents/release-intent.json?ref=${sourceSha}`].content = Buffer.from(
    JSON.stringify({ schema: 1, channel: "next", packages: [{ name: "@ternent/workspace" }] }),
  ).toString("base64");
  await assert.rejects(() => selectRelease({ runId: 10, api: f.api }), /five public libraries/);
});

await test("wrong, expired, stale-attempt and ambiguous artifacts are rejected", async () => {
  for (const alter of /** @type {((value:any)=>void)[]} */ ([
    (a) => (a.expired = true),
    (a) => (a.workflow_run.head_sha = parentSha),
    (a) => (a.workflow_run.id = 11),
    (a) => (a.digest = "sha256:invalid"),
    (a) => (a.created_at = "2026-11-20T12:00:00Z"),
  ])) {
    const f = responses();
    alter(f.values[`${rootApi}/actions/runs/10/artifacts?per_page=100`].artifacts[0]);
    await assert.rejects(() => selectRelease({ runId: 10, api: f.api }));
  }
  const f = responses();
  const artifacts = f.values[`${rootApi}/actions/runs/10/artifacts?per_page=100`].artifacts;
  artifacts.push(copy(artifacts[0]));
  await assert.rejects(() => selectRelease({ runId: 10, api: f.api }), /exactly one/);
  f.values[`${rootApi}/compare/${sourceSha}...main`].status = "diverged";
  await assert.rejects(() => selectRelease({ runId: 10, api: f.api }), /no longer on main/);
});

await test("archive digest and paths are checked before extraction; unsafe entries cannot escape", async (t) => {
  const root = temporary(t),
    archive = zipSync({ "release/plan.json": strToU8("checked") });
  await assert.rejects(
    () =>
      extractArtifact({
        id: 20,
        digest: `sha256:${"0".repeat(64)}`,
        directory: join(root, "bad"),
        readArchive: async () => archive,
      }),
    /digest mismatch/,
  );
  assert(!existsSync(join(root, "bad")));
  const escaped = zipSync({ "../escape": strToU8("unsafe") });
  await assert.rejects(
    () =>
      extractArtifact({
        id: 20,
        digest: `sha256:${sha256(escaped)}`,
        directory: join(root, "unsafe"),
        readArchive: async () => escaped,
      }),
    /Unsafe/,
  );
  assert(!existsSync(join(root, "escape")));
  await extractArtifact({
    id: 20,
    digest: `sha256:${sha256(archive)}`,
    directory: join(root, "good"),
    readArchive: async () => archive,
  });
  assert.equal(readFileSync(join(root, "good/release/plan.json"), "utf8"), "checked");
});

await test("staging restores captured verifier files without building or changing candidate bytes", async (t) => {
  const root = temporary(t),
    archive = producerArchive(),
    f = responses(archive);
  const { selection } = await selectRelease({ runId: 10, api: f.api });
  assert(selection);
  const result = await stageRelease({
    root,
    selection,
    api: f.api,
    readArchive: async () => archive,
  });
  assert.deepEqual(result, { releaseId, resumed: false });
  assert.equal(
    readFileSync(join(root, "artifacts/release/candidates/candidate.tgz"), "utf8"),
    "immutable candidate",
  );
  assert.equal(
    readFileSync(join(root, "packages/seal/dist/index.js"), "utf8"),
    "export const verified = true;",
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "artifacts/release-origin.json"), "utf8")).sourceSha,
    sourceSha,
  );
});

await test("a requested release ID cannot select another plan even from an otherwise valid producer", async (t) => {
  const root = temporary(t),
    archive = producerArchive(),
    f = responses(archive);
  const { selection } = await selectRelease({
    runId: 10,
    api: f.api,
    requestedReleaseId: "f".repeat(64),
  });
  assert(selection);
  await assert.rejects(
    () => stageRelease({ root, selection, api: f.api, readArchive: async () => archive }),
    /selected source\/release/,
  );
  assert(!existsSync(join(root, "packages/seal/dist/index.js")));
});

await test("retry handoff retains the existing signed bundle and publication journal", async (t) => {
  const root = temporary(t),
    archive = producerArchive(),
    f = responses(archive);
  const { selection } = await selectRelease({ runId: 10, api: f.api });
  assert(selection);
  const handoff = {
    schema: 1,
    repository: "ternent/core",
    sourceSha,
    runId: 10,
    artifactId: 20,
    artifactDigest: selection.artifactDigest,
    releaseId,
  };
  const priorPlan = JSON.parse(
    Buffer.from(
      (await import("fflate")).unzipSync(archive)["release/release-plan.json"],
    ).toString(),
  );
  const prior = zipSync(
    Object.fromEntries([
      entry("release/release-plan.json", JSON.stringify(priorPlan)),
      entry("release/release-proof.json", "unchanged production proof"),
      entry("release/release-origin.json", JSON.stringify(handoff)),
      entry(
        "release-receipt.json",
        JSON.stringify({ sourceSha, releaseId, status: "incomplete", attempt: 1 }),
      ),
      ...["identity", "armour", "seal"].map((name) =>
        entry(`release/tools/packages/${name}/dist/index.js`, "export const verified = true;"),
      ),
    ]),
  );
  f.values[`${rootApi}/actions/runs/30`] = {
    id: 30,
    workflow_id: 8,
    path: ".github/workflows/release.yml",
    repository: { full_name: "ternent/core" },
    head_repository: { full_name: "ternent/core" },
    head_branch: "main",
    head_sha: workflowSha,
    event: "workflow_run",
  };
  f.values[`${rootApi}/actions/workflows/release.yml`] = { id: 8 };
  f.values[`${rootApi}/actions/runs/30/artifacts?per_page=100`] = {
    artifacts: [
      {
        id: 40,
        name: `core-release-${releaseId}-attempt-1`,
        expired: false,
        digest: `sha256:${sha256(prior)}`,
        size_in_bytes: prior.length,
        workflow_run: { id: 30, head_sha: workflowSha },
      },
    ],
  };
  const result = await stageRelease({
    root,
    selection,
    resumeRunId: 30,
    api: f.api,
    readArchive: async (id) => (id === 20 ? archive : prior),
  });
  assert.equal(result.resumed, true);
  assert.equal(
    readFileSync(join(root, "artifacts/release/release-proof.json"), "utf8"),
    "unchanged production proof",
  );
  assert.equal(
    JSON.parse(readFileSync(join(root, "artifacts/release-receipt.json"), "utf8")).attempt,
    1,
  );
  f.values[`${rootApi}/actions/runs/30`].head_repository.full_name = "fork/core";
  await assert.rejects(
    () =>
      stageRelease({
        root: join(root, "other"),
        selection,
        resumeRunId: 30,
        api: f.api,
        readArchive: async () => archive,
      }),
    /main workflows/,
  );
});

await test("captured tools are separate from tarballs and restoring them never invokes a builder", (t) => {
  const root = temporary(t),
    bundle = join(root, "bundle");
  mkdirSync(bundle);
  for (const name of ["identity", "armour", "seal"])
    put(join(root, "packages", name, "dist/index.js"), "original verifier");
  captureTools(root, bundle);
  put(join(root, "packages/seal/dist/index.js"), "changed local file");
  restoreTools(root, bundle);
  assert.equal(
    readFileSync(join(root, "packages/seal/dist/index.js"), "utf8"),
    "original verifier",
  );
});

import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { packageNames, requireThat, sha256 } from "./shared.mjs";

const repository = "ternent/core";
const apiRoot = `repos/${repository}`;
const toolPackages = ["identity", "armour", "seal"];
/** @typedef {{sourceSha:string,runId:number,artifactId:number,artifactDigest:string,requestedReleaseId:string}} Selection */
/** @param {unknown} value */
function identifier(value) {
  const number = Number(value);
  requireThat(
    /^\d+$/.test(String(value)) && Number.isSafeInteger(number) && number > 0,
    "ORIGIN_INVALID",
    "Invalid workflow/artifact identifier",
  );
  return number;
}
/** @param {string} path @returns {Promise<any>} */
export async function github(path) {
  const result = spawnSync("gh", ["api", path], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    if (result.stderr.includes("HTTP 404")) return null;
    throw new Error("GITHUB_UNAVAILABLE: cannot read workflow provenance");
  }
  return JSON.parse(result.stdout);
}
/** @param {any} run @param {string} path */
function origin(run, path) {
  requireThat(
    run?.repository?.full_name === repository &&
      run.head_repository?.full_name === repository &&
      run.head_branch === "main" &&
      run.path === path &&
      /^[a-f0-9]{40}$/.test(run.head_sha),
    "ORIGIN_INVALID",
    "Only this repository's main workflows are eligible",
  );
}
/** @param {any} response */
function contents(response) {
  requireThat(
    response?.encoding === "base64" && typeof response.content === "string",
    "ORIGIN_INVALID",
    "Missing committed source content",
  );
  return Buffer.from(response.content, "base64");
}
/** @param {any} artifact @param {number} runId @param {string} sourceSha */
function artifactOrigin(artifact, runId, sourceSha) {
  requireThat(
    artifact &&
      artifact.expired === false &&
      artifact.workflow_run?.id === runId &&
      artifact.workflow_run.head_sha === sourceSha &&
      /^sha256:[a-f0-9]{64}$/.test(artifact.digest) &&
      Number.isSafeInteger(artifact.size_in_bytes) &&
      artifact.size_in_bytes > 0 &&
      artifact.size_in_bytes < 128 * 1024 * 1024,
    "ORIGIN_INVALID",
    "Artifact is expired, oversized or belongs to another run",
  );
  identifier(artifact.id);
}
/** Select an immutable artifact from successful main push verification, never PR evidence.
 * @param {{runId:unknown,requestedReleaseId?:string,api?:(path:string)=>Promise<any>}} input
 */
export async function selectRelease({ runId, requestedReleaseId = "", api = github }) {
  const id = identifier(runId);
  requireThat(
    requestedReleaseId === "" || /^[a-f0-9]{64}$/.test(requestedReleaseId),
    "ORIGIN_INVALID",
    "Invalid requested release ID",
  );
  const run = await api(`${apiRoot}/actions/runs/${id}`);
  origin(run, ".github/workflows/ci.yml");
  requireThat(
    run.id === id &&
      run.event === "push" &&
      run.status === "completed" &&
      run.conclusion === "success",
    "ORIGIN_INVALID",
    "Verification must be a successful main push run",
  );
  const workflow = await api(`${apiRoot}/actions/workflows/ci.yml`);
  requireThat(
    run.workflow_id === workflow?.id,
    "ORIGIN_INVALID",
    "Unexpected verification workflow identity",
  );
  const ancestry = await api(`${apiRoot}/compare/${run.head_sha}...main`);
  requireThat(
    ["ahead", "identical"].includes(ancestry?.status),
    "ORIGIN_INVALID",
    "Source revision is no longer on main",
  );
  const intent = await api(`${apiRoot}/contents/release-intent.json?ref=${run.head_sha}`);
  if (!intent) {
    requireThat(!requestedReleaseId, "INTENT_MISSING", "Requested run has no release intent");
    return { status: "noop", reason: "No committed release intent" };
  }
  const bytes = contents(intent),
    parsed = JSON.parse(bytes.toString("utf8"));
  requireThat(
    parsed.schema === 1 &&
      parsed.channel === "next" &&
      Array.isArray(parsed.packages) &&
      JSON.stringify(parsed.packages.map((/** @type {any} */ p) => p.name).sort()) ===
        JSON.stringify([...packageNames].sort()),
    "ORIGIN_INVALID",
    "Release intent must select the five public libraries",
  );
  const commit = await api(`${apiRoot}/git/commits/${run.head_sha}`);
  const parent = commit?.parents?.[0]?.sha;
  requireThat(
    typeof parent === "string" && /^[a-f0-9]{40}$/.test(parent),
    "ORIGIN_INVALID",
    "Missing version commit parent",
  );
  const previous = await api(`${apiRoot}/contents/release-intent.json?ref=${parent}`);
  if (previous && contents(previous).equals(bytes) && !requestedReleaseId) {
    return { status: "noop", reason: "Release intent did not change in this commit" };
  }
  const artifacts = await api(`${apiRoot}/actions/runs/${id}/artifacts?per_page=100`);
  const matches =
    artifacts?.artifacts?.filter((/** @type {any} */ a) => a.name === "core-evidence") ?? [];
  requireThat(
    matches.length === 1,
    "ORIGIN_INVALID",
    "Expected exactly one retained candidate artifact",
  );
  const artifact = matches[0];
  artifactOrigin(artifact, id, run.head_sha);
  requireThat(
    Date.parse(artifact.created_at) >= Date.parse(run.run_started_at),
    "ORIGIN_INVALID",
    "Artifact predates the verified run attempt",
  );
  /** @type {Selection} */
  const selection = {
    sourceSha: run.head_sha,
    runId: id,
    artifactId: artifact.id,
    artifactDigest: artifact.digest,
    requestedReleaseId,
  };
  return { status: "selected", selection };
}

/** Transport integrity is checked before extracting or executing any artifact code.
 * @param {{id:number,digest:string,directory:string,readArchive?:(id:number)=>Promise<Uint8Array>}} input
 */
export async function extractArtifact({ id, digest, directory, readArchive }) {
  identifier(id);
  const archive = readArchive
    ? await readArchive(id)
    : execFileSync("gh", ["api", `${apiRoot}/actions/artifacts/${id}/zip`], {
        maxBuffer: 128 * 1024 * 1024,
      });
  requireThat(
    `sha256:${sha256(archive)}` === digest,
    "DIGEST_MISMATCH",
    "GitHub artifact archive digest mismatch",
  );
  const { unzipSync } = await import("fflate");
  let size = 0,
    count = 0;
  const files = unzipSync(archive, {
    filter(file) {
      size += file.originalSize;
      count++;
      requireThat(
        count <= 10_000 &&
          size <= 256 * 1024 * 1024 &&
          !file.name.startsWith("/") &&
          !file.name.includes("\\") &&
          file.name.split("/").every((part) => part !== ".." && part !== "."),
        "PATH_INVALID",
        "Unsafe or oversized archive entry",
      );
      return true;
    },
  });
  requireThat(!existsSync(directory), "ARTIFACT_EXISTS", "Extraction destination must be new");
  mkdirSync(directory, { recursive: true });
  for (const [name, bytes] of Object.entries(files)) {
    if (name.endsWith("/")) continue;
    requireThat(
      name.length > 0 && !name.includes("\0"),
      "PATH_INVALID",
      "Invalid archive filename",
    );
    const file = join(directory, name);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, bytes, { flag: "wx" });
  }
}
/** @param {string} directory */
function regularTree(directory) {
  requireThat(
    lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink(),
    "PATH_INVALID",
    "Expected a regular tools directory",
  );
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    requireThat(
      !entry.isSymbolicLink() && (entry.isFile() || entry.isDirectory()),
      "PATH_INVALID",
      "Tools must contain regular files only",
    );
    if (entry.isDirectory()) regularTree(join(directory, entry.name));
  }
}
/** Preserve the already-built verifier; no build/repack runs in the publisher.
 * @param {string} root @param {string} bundle
 */
export function captureTools(root, bundle) {
  for (const name of toolPackages) {
    const source = join(root, "packages", name, "dist"),
      target = join(bundle, "tools/packages", name, "dist");
    regularTree(source);
    requireThat(!existsSync(target), "ARTIFACT_EXISTS", "Verifier tools already captured");
    cpSync(source, target, { recursive: true });
  }
}
/** @param {string} root @param {string} bundle */
export function restoreTools(root, bundle) {
  for (const name of toolPackages) {
    const source = join(bundle, "tools/packages", name, "dist"),
      target = join(root, "packages", name, "dist");
    requireThat(
      existsSync(join(source, "index.js")),
      "ARTIFACT_MISSING",
      "Verified CLI tools were not retained",
    );
    regularTree(source);
    rmSync(target, { recursive: true, force: true });
    cpSync(source, target, { recursive: true });
  }
}
/** @param {Selection} selection @param {any} plan */
function bindPlan(selection, plan) {
  requireThat(
    plan.sourceSha === selection.sourceSha &&
      /^[a-f0-9]{64}$/.test(plan.releaseId) &&
      (!selection.requestedReleaseId || plan.releaseId === selection.requestedReleaseId),
    "ORIGIN_INVALID",
    "Artifact does not match selected source/release",
  );
}
/** @param {{root:string,selection:Selection,resumeRunId?:unknown,api?:(path:string)=>Promise<any>,readArchive?:(id:number)=>Promise<Uint8Array>}} input */
export async function stageRelease({ root, selection, resumeRunId, api = github, readArchive }) {
  const directory = join(root, "artifacts/release");
  requireThat(!existsSync(directory), "ARTIFACT_EXISTS", "Release destination must be new");
  const temporary = mkdtempSync(join(tmpdir(), "ternent-release-handoff-"));
  try {
    const original = join(temporary, "original");
    await extractArtifact({
      id: selection.artifactId,
      digest: selection.artifactDigest,
      directory: original,
      readArchive,
    });
    const fresh = join(original, "release"),
      plan = JSON.parse(readFileSync(join(fresh, "release-plan.json"), "utf8"));
    bindPlan(selection, plan);
    requireThat(
      plan.packages?.length === 5 && plan.intentSha256,
      "INTENT_MISSING",
      "Production requires a nonempty release plan",
    );
    let bundle = fresh,
      receipt;
    if (resumeRunId) {
      const resumeId = identifier(resumeRunId);
      const run = await api(`${apiRoot}/actions/runs/${resumeId}`);
      origin(run, ".github/workflows/release.yml");
      const workflow = await api(`${apiRoot}/actions/workflows/release.yml`);
      requireThat(
        run.id === resumeId &&
          run.workflow_id === workflow?.id &&
          ["workflow_run", "workflow_dispatch"].includes(run.event),
        "ORIGIN_INVALID",
        "Unexpected retry workflow",
      );
      const artifacts = await api(`${apiRoot}/actions/runs/${resumeId}/artifacts?per_page=100`);
      const prefix = `core-release-${plan.releaseId}-attempt-`;
      const matches = (artifacts?.artifacts ?? [])
        .filter(
          (/** @type {any} */ a) =>
            a.name.startsWith(prefix) && /^\d+$/.test(a.name.slice(prefix.length)),
        )
        .sort(
          (/** @type {any} */ a, /** @type {any} */ b) =>
            Number(b.name.slice(prefix.length)) - Number(a.name.slice(prefix.length)),
        );
      if (matches.length) {
        const previous = matches[0];
        artifactOrigin(previous, resumeId, run.head_sha);
        const prior = join(temporary, "prior");
        await extractArtifact({
          id: previous.id,
          digest: previous.digest,
          directory: prior,
          readArchive,
        });
        const receiptPath = join(prior, "release-receipt.json");
        if (existsSync(receiptPath)) {
          receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
          requireThat(
            receipt.releaseId === plan.releaseId && receipt.sourceSha === plan.sourceSha,
            "ORIGIN_INVALID",
            "Retry journal belongs to another release",
          );
          bundle = join(prior, "release");
          const priorPlan = JSON.parse(readFileSync(join(bundle, "release-plan.json"), "utf8"));
          bindPlan(selection, priorPlan);
          requireThat(
            priorPlan.releaseId === plan.releaseId,
            "ORIGIN_INVALID",
            "Retry changed the immutable release plan",
          );
        } else
          requireThat(
            String(resumeId) === process.env.GITHUB_RUN_ID,
            "ARTIFACT_MISSING",
            "Requested retry artifact has no publication journal",
          );
      } else
        requireThat(
          String(resumeId) === process.env.GITHUB_RUN_ID,
          "ARTIFACT_MISSING",
          "Requested retry run has no matching retained journal",
        );
    }
    mkdirSync(dirname(directory), { recursive: true });
    cpSync(bundle, directory, { recursive: true });
    const handoff = {
      schema: 1,
      repository,
      sourceSha: selection.sourceSha,
      runId: selection.runId,
      artifactId: selection.artifactId,
      artifactDigest: selection.artifactDigest,
      releaseId: plan.releaseId,
    };
    if (receipt) {
      const prior = JSON.parse(readFileSync(join(directory, "release-origin.json"), "utf8"));
      requireThat(
        JSON.stringify(prior) === JSON.stringify(handoff),
        "ORIGIN_INVALID",
        "Retry changed producer provenance",
      );
      writeFileSync(join(root, "artifacts/release-receipt.json"), `${JSON.stringify(receipt)}\n`);
    }
    writeFileSync(join(root, "artifacts/release-origin.json"), `${JSON.stringify(handoff)}\n`);
    restoreTools(root, directory);
    return { releaseId: plan.releaseId, resumed: Boolean(receipt) };
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

/** @param {Record<string,string>} values */
function outputs(values) {
  requireThat(process.env.GITHUB_OUTPUT, "HOST_CONFIGURATION", "GITHUB_OUTPUT is required");
  for (const [name, value] of Object.entries(values)) {
    requireThat(!/[\r\n]/.test(value), "HOST_CONFIGURATION", "Invalid workflow output");
    appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const command = process.argv[2],
      root = process.cwd();
    if (command === "capture-tools") captureTools(root, resolve("artifacts/release"));
    else if (command === "version-needed") {
      const temporary = mkdtempSync(join(tmpdir(), "ternent-changesets-status-"));
      try {
        const file = join(temporary, "status.json");
        execFileSync("pnpm", ["exec", "changeset", "status", "--output", file], {
          stdio: "inherit",
        });
        const status = JSON.parse(readFileSync(file, "utf8"));
        // Changesets 3 already excludes consumed .changeset/pre/* entries.
        const needed = status.changesets.some(
          (/** @type {any} */ change) => change.releases.length > 0,
        );
        outputs({ needed: String(needed) });
      } finally {
        rmSync(temporary, { recursive: true, force: true });
      }
    } else if (command === "select" || command === "stage") {
      requireThat(
        process.env.GITHUB_REPOSITORY === repository &&
          process.env.GITHUB_REF === "refs/heads/main" &&
          process.env.GITHUB_WORKFLOW_REF ===
            `${repository}/.github/workflows/release.yml@refs/heads/main`,
        "ORIGIN_INVALID",
        "Release workflow must run from main in this repository",
      );
      if (process.env.GITHUB_EVENT_NAME === "workflow_dispatch")
        requireThat(
          process.env.EXPECTED_RELEASE_ID,
          "ORIGIN_INVALID",
          "Dispatch requires an exact release ID",
        );
      const result = await selectRelease({
        runId: process.env.RELEASE_RUN_ID,
        requestedReleaseId: process.env.EXPECTED_RELEASE_ID,
      });
      if (!result.selection) {
        requireThat(
          command === "select",
          "ORIGIN_INVALID",
          "Release selection is no longer eligible",
        );
        outputs({ eligible: "false" });
        console.log(result.reason);
      } else if (command === "select")
        outputs({
          eligible: "true",
          "source-sha": result.selection.sourceSha,
          "artifact-id": String(result.selection.artifactId),
          "artifact-digest": result.selection.artifactDigest,
        });
      else {
        requireThat(
          result.selection.sourceSha === process.env.RELEASE_SOURCE_SHA &&
            String(result.selection.artifactId) === process.env.RELEASE_ARTIFACT_ID &&
            result.selection.artifactDigest === process.env.RELEASE_ARTIFACT_DIGEST,
          "ORIGIN_INVALID",
          "Producer changed after release selection",
        );
        const staged = await stageRelease({
          root,
          selection: result.selection,
          resumeRunId: process.env.RESUME_RELEASE_RUN_ID,
        });
        outputs({
          "release-id": staged.releaseId,
          resumed: String(staged.resumed),
          node: process.execPath,
        });
      }
    } else if (command === "collect") {
      const target = resolve("artifacts/release-attempt");
      mkdirSync(target, { recursive: true });
      if (existsSync("artifacts/release"))
        cpSync("artifacts/release", join(target, "release"), { recursive: true });
      if (existsSync("artifacts/release-receipt.json"))
        cpSync("artifacts/release-receipt.json", join(target, "release-receipt.json"));
      writeFileSync(
        join(target, "workflow.json"),
        JSON.stringify({
          runId: process.env.GITHUB_RUN_ID,
          attempt: process.env.GITHUB_RUN_ATTEMPT,
          sourceSha: process.env.RELEASE_SOURCE_SHA,
        }),
      );
    } else throw new Error("Unknown release workflow command");
  } catch (error) {
    console.error(JSON.stringify({ phase: "handoff", error: String(error) }));
    process.exitCode = 1;
  }
}

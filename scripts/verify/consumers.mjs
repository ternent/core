import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { workspacePackages } from "./workspace.mjs";
import { startCandidateRegistry } from "./candidate-registry.mjs";

const root = process.cwd();
const publishedBundle = process.env.VERIFY_PUBLISHED_BUNDLE;
const retained = publishedBundle
  ? JSON.parse(readFileSync(join(publishedBundle, "release-plan.json"), "utf8"))
  : undefined;
const sourceSha =
  process.env.GITHUB_SHA ?? execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const rootManifest = /** @type {{devDependencies: Record<string, string>}} */ (
  JSON.parse(readFileSync("package.json", "utf8"))
);
const packages = workspacePackages();
assert.deepEqual(packages.map(({ name }) => name).sort(), [
  "@ternent/armour",
  "@ternent/concord",
  "@ternent/identity",
  "@ternent/ledger",
  "@ternent/seal",
]);
mkdirSync("artifacts", { recursive: true });
const candidateDir = mkdtempSync(resolve("artifacts", "candidates-"));
const consumer = mkdtempSync(join(tmpdir(), "ternent-packed-consumer-"));
/** @type {Record<string, {file: string, version: string, sha256: string, integrity: string}>} */
const candidates = {};
/** @type {string[]} */
const checks = [];
/** @type {Awaited<ReturnType<typeof startCandidateRegistry>> | undefined} */
let registry;
/** @type {{name: string, version: string, path: string, files: number}[]} */
const installedCandidates = [];

/** @param {string[]} args @param {string} [cwd] */
function pnpm(args, cwd = consumer) {
  return execFileSync("pnpm", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, CI: "true", NPM_CONFIG_USERCONFIG: "/dev/null" },
    maxBuffer: 8 * 1024 * 1024,
  });
}

/** @param {string} name @param {string | object} value */
function put(name, value) {
  const path = join(consumer, name);
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`);
}

/** Serve the temporary production browser bundle. @param {string} directory */
async function serve(directory) {
  const types = /** @type {Record<string, string>} */ ({
    ".html": "text/html",
    ".js": "application/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".svg": "image/svg+xml",
    ".woff2": "font/woff2",
  });
  const server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    let file = resolve(directory, `.${pathname}`);
    const local = relative(directory, file);
    if (local === ".." || local.startsWith(`..${sep}`)) {
      response.writeHead(400).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file)) {
      response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
      return;
    }
    response.writeHead(200, { "Content-Type": types[extname(file)] ?? "application/octet-stream" });
    response.end(readFileSync(file));
  });
  await new Promise((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen(undefined));
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolveClose, reject) =>
        server.close((error) => (error ? reject(error) : resolveClose(undefined))),
      ),
  };
}

try {
  for (const entry of packages) {
    const expected = retained?.packages.find(
      (/** @type {{name:string}} */ item) => item.name === entry.name,
    );
    let file;
    if (publishedBundle) {
      assert(expected, `Missing retained candidate: ${entry.name}`);
      file = resolve(publishedBundle, expected.tarball);
      const local = relative(resolve(publishedBundle), file);
      assert(
        local && !local.startsWith("..") && !local.startsWith(sep),
        "Invalid retained candidate path",
      );
      assert.equal(createHash("sha256").update(readFileSync(file)).digest("hex"), expected.sha256);
    } else {
      const result = JSON.parse(
        pnpm(["pack", "--json", "--pack-destination", candidateDir], entry.path),
      );
      const packed = Array.isArray(result) ? result[0] : result;
      file = resolve(candidateDir, packed.filename);
    }
    assert(existsSync(file), `Missing packed file: ${file}`);
    console.log(pnpm(["exec", "publint", file, "--strict"], root));
    candidates[entry.name] = {
      file,
      version: JSON.parse(
        execFileSync("tar", ["-xOf", file, "package/package.json"], { encoding: "utf8" }),
      ).version,
      integrity: `sha512-${createHash("sha512").update(readFileSync(file)).digest("base64")}`,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  }
  checks.push("all five exact library tarballs pass strict publint validation");
  if (!publishedBundle)
    registry = await startCandidateRegistry(resolve("artifacts/candidate-registry.log"));
  const registryUrl = registry?.url ?? "https://registry.npmjs.org";
  const npmrc = `registry=https://registry.npmjs.org/\n@ternent:registry=${registryUrl}/\n@ternent-verify:registry=${registryUrl}/\n`;
  put(".npmrc", npmrc);
  put("pnpm-workspace.yaml", "packages: []\nallowBuilds: {}\n");
  put("package.json", {
    name: "@ternent-consumers/verification",
    version: "1.0.0",
    private: true,
    type: "module",
  });

  if (!publishedBundle) {
    /** @param {string} file */
    function publish(file) {
      // All publication is anonymous and confined to the child registry; never use npm defaults.
      assert.equal(new URL(registryUrl).hostname, "127.0.0.1");
      const manifest = JSON.parse(
        execFileSync("tar", ["-xOf", file, "package/package.json"], { encoding: "utf8" }),
      );
      assert(
        !manifest.publishConfig?.registry,
        "A packed publishConfig.registry must not redirect publication",
      );
      console.log(
        pnpm([
          "publish",
          file,
          "--registry",
          registryUrl,
          "--no-git-checks",
          "--ignore-scripts",
          "--tag",
          "candidate",
        ]),
      );
    }

    /** @param {string} label @param {Record<string, string>} dependencies @param {RegExp} diagnostic */
    function rejectResolution(label, dependencies, diagnostic) {
      const directory = join(consumer, "probes", label);
      put(`probes/${label}/package.json`, {
        name: `@ternent-consumers/${label}`,
        version: "1.0.0",
        private: true,
        dependencies,
      });
      put(`probes/${label}/pnpm-workspace.yaml`, "packages: []\nallowBuilds: {}\n");
      put(
        `probes/${label}/.npmrc`,
        `${npmrc}cache-dir=${join(directory, "cache")}\nfetch-retries=0\n`,
      );
      const result = spawnSync(
        "pnpm",
        ["install", "--lockfile-only", "--ignore-scripts", "--store-dir", join(directory, "store")],
        {
          cwd: directory,
          encoding: "utf8",
          env: { ...process.env, CI: "true", NPM_CONFIG_USERCONFIG: "/dev/null" },
        },
      );
      assert.notEqual(result.status, 0, `${label} unexpectedly resolved`);
      const output = `${result.stdout}${result.stderr}`;
      assert.match(output, diagnostic);
      assert.match(output, /@ternent\/identity/);
      writeFileSync(resolve("artifacts", `registry-${label}.log`), output);
    }

    // A real sibling is deliberately absent, even if a predecessor exists on public npm.
    publish(candidates["@ternent/armour"].file);
    assert.equal((await fetch(`${registryUrl}/@ternent%2fidentity`)).status, 404);
    rejectResolution(
      "missing-sibling",
      { "@ternent/armour": candidates["@ternent/armour"].version },
      /ERR_PNPM_FETCH_404/,
    );
    for (const [name, candidate] of Object.entries(candidates))
      if (name !== "@ternent/armour") publish(candidate.file);

    // Only the probe's transitive range is wrong; no direct Identity dependency masks it.
    const probeName = "@ternent-verify/bad-sibling";
    put("probes/range-package/package.json", {
      name: probeName,
      version: "1.0.0",
      files: ["index.js"],
      exports: "./index.js",
      type: "module",
      dependencies: { "@ternent/identity": "999999.0.0-b13" },
    });
    put("probes/range-package/index.js", 'export { generateSigner } from "@ternent/identity";\n');
    const probePack = JSON.parse(
      pnpm(
        ["pack", "--json", "--pack-destination", join(consumer, "probes")],
        join(consumer, "probes/range-package"),
      ),
    );
    publish(
      resolve(consumer, "probes", (Array.isArray(probePack) ? probePack[0] : probePack).filename),
    );
    rejectResolution(
      "incompatible-sibling",
      { [probeName]: "1.0.0" },
      /ERR_PNPM_NO_MATCHING_VERSION/,
    );
    checks.push(
      "fresh registry resolution rejects an absent real sibling and an incompatible transitive sibling range without public npm fallback",
    );
  }

  for (const [name, candidate] of Object.entries(candidates)) {
    const response = await fetch(`${registryUrl}/${encodeURIComponent(name)}/${candidate.version}`);
    assert.equal(response.status, 200);
    const metadata = await response.json();
    assert.equal(metadata.name, name);
    assert.equal(metadata.version, candidate.version);
    assert.equal(metadata.dist.integrity, candidate.integrity);
    assert.equal(new URL(metadata.dist.tarball).origin, registryUrl);
    const tarball = await fetch(metadata.dist.tarball);
    assert.equal(tarball.status, 200);
    assert.equal(
      createHash("sha256")
        .update(Buffer.from(await tarball.arrayBuffer()))
        .digest("hex"),
      candidate.sha256,
    );
  }
  const dependencies = Object.fromEntries(
    Object.entries(candidates).map(([name, data]) => [name, data.version]),
  );
  for (const name of ["vite-plus", "typescript", "vue", "@types/node"]) {
    assert(rootManifest.devDependencies[name], `Missing consumer tool: ${name}`);
    dependencies[name] = rootManifest.devDependencies[name];
  }
  put("package.json", {
    name: "@ternent-consumers/verification",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies,
  });
  put(".npmrc", `${npmrc}cache-dir=${join(consumer, "metadata-cache")}\n`);
  console.log(
    pnpm([
      "install",
      "--ignore-scripts",
      "--store-dir",
      publishedBundle ? join(consumer, "store") : resolve(root, ".pnpm-store"),
    ]),
  );

  const lock = readFileSync(join(consumer, "pnpm-lock.yaml"), "utf8").split("\n");
  for (const [name, candidate] of Object.entries(candidates)) {
    const key = `${name}@${candidate.version}:`;
    const index = lock.findIndex((line) => line.trim().replace(/^'|'(?=:)/g, "") === key);
    assert(index >= 0, `Candidate absent from lockfile: ${key}`);
    const resolution = lock[index + 1];
    assert(
      resolution?.includes(`integrity: ${candidate.integrity}`),
      `Wrong locked candidate integrity: ${key}`,
    );
  }
  /** @typedef {{version?: string, path?: string, dependencies?: Record<string, Installed>, devDependencies?: Record<string, Installed>, optionalDependencies?: Record<string, Installed>}} Installed */
  /** @type {Set<string>} */
  const inspected = new Set();
  /** @param {Installed} tree */
  function verifyInstalled(tree) {
    for (const kind of ["dependencies", "devDependencies", "optionalDependencies"]) {
      const group = tree[/** @type {"dependencies"} */ (kind)] ?? {};
      for (const [name, installed] of Object.entries(group)) {
        const candidate = candidates[name];
        if (candidate) {
          assert.equal(installed.version, candidate.version, `Wrong installed version: ${name}`);
          assert(installed.path, `Missing installed location: ${name}`);
          const path = realpathSync(installed.path);
          if (!inspected.has(path)) {
            inspected.add(path);
            const files = execFileSync("tar", ["-tzf", candidate.file], { encoding: "utf8" })
              .trim()
              .split("\n")
              .filter((file) => !file.endsWith("/"));
            for (const file of files) {
              assert(file.startsWith("package/") && !file.split("/").includes(".."));
              assert.deepEqual(
                readFileSync(join(path, file.slice("package/".length))),
                execFileSync("tar", ["-xOf", candidate.file, file]),
                `Installed bytes differ: ${name}/${file}`,
              );
            }
            installedCandidates.push({
              name,
              version: candidate.version,
              path,
              files: files.length,
            });
          }
        }
        verifyInstalled(installed);
      }
    }
  }
  const trees = JSON.parse(pnpm(["list", "--json", "--depth", "Infinity"]));
  for (const tree of trees) verifyInstalled(tree);
  assert.deepEqual(
    [...new Set(installedCandidates.map(({ name }) => name))].sort(),
    Object.keys(candidates).sort(),
  );
  checks.push(
    `${publishedBundle ? "fresh public-registry" : "temporary-registry"} names/versions resolve without sibling overrides; registry tarball digests, locked SRI and every resolved candidate copy match the packed bytes`,
  );
  for (const name of [
    "owner.document.json",
    "owner.expected.json",
    "groups.removed.document.json",
    "groups.readmitted.document.json",
    "groups.expected.json",
  ])
    cpSync(resolve(root, "docs/concord/vectors", name), join(consumer, name));
  cpSync(
    resolve(root, "packages/ledger/test/vectors/signed-log.json"),
    join(consumer, "ledger-signed-log.json"),
  );
  put("ledger.mjs", readFileSync(resolve(root, "scripts/verify/ledger-consumer.txt"), "utf8"));
  put("payload.mjs", readFileSync(resolve(root, "scripts/verify/payload-consumer.txt"), "utf8"));
  put("storage.mjs", readFileSync(resolve(root, "scripts/verify/storage-consumer.txt"), "utf8"));
  put("groups.mjs", readFileSync(resolve(root, "scripts/verify/groups-consumer.txt"), "utf8"));
  put("concord.mjs", readFileSync(resolve(root, "scripts/verify/concord-consumer.txt"), "utf8"));
  put(
    "primitives.mjs",
    readFileSync(resolve(root, "scripts/verify/primitives-consumer.txt"), "utf8"),
  );
  put(
    "protocol-isolation.mjs",
    readFileSync(resolve(root, "scripts/verify/protocol-isolation.txt"), "utf8"),
  );
  const runtimes = [process.execPath];
  for (const major of [22, 24]) {
    const executable = process.env[`CONCORD_NODE${major}`];
    if (!executable) {
      assert(
        process.env.VERIFY_COMPATIBILITY !== "true",
        `Set CONCORD_NODE${major} for compatibility verification`,
      );
      continue;
    }
    assert.match(
      execFileSync(executable, ["--version"], { encoding: "utf8" }),
      new RegExp(`^v${major}\\.`),
    );
    runtimes.push(executable);
  }
  const versions = runtimes
    .map((executable) => execFileSync(executable, ["--version"], { encoding: "utf8" }).trim())
    .join(", ");
  for (const executable of runtimes) {
    console.log(execFileSync(executable, ["ledger.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["payload.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["primitives.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["concord.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["groups.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["storage.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(
      execFileSync(executable, ["protocol-isolation.mjs"], { cwd: consumer, encoding: "utf8" }),
    );
  }
  checks.push(
    `Identity, Armour and all Concord subpaths: lifecycle, draft batching, signed metadata and fixed vectors on ${versions}; protocol import isolation`,
  );
  checks.push(
    `Independent group saved vectors, readable coverage, scoped authoring and retryable cross-group draft commits on ${versions}`,
  );
  checks.push(
    `Identity mnemonic/serialization/signing and init-free Armour helper contracts on ${versions}`,
  );
  checks.push(
    `External artifact storage, expected-head conflicts, retained forks and committed-only draft publication on ${versions}`,
  );
  checks.push(
    `Standalone Ledger lifecycle, fixed vectors, declarations and import isolation on ${versions}`,
  );
  checks.push(
    `Optional Armour payload codec, keyless Ledger verification and locked/readable decoding on ${versions}`,
  );
  put("tsconfig.json", {
    compilerOptions: {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      verbatimModuleSyntax: true,
      resolveJsonModule: true,
      forceConsistentCasingInFileNames: true,
      lib: ["ES2022", "DOM"],
      types: ["node", "vite-plus/client"],
    },
    include: [
      "concord-types.ts",
      "primitives-types.ts",
      "groups-types.ts",
      "storage-types.ts",
      "ledger-types.ts",
      "src/**/*.ts",
      "vite.config.ts",
      "feedback.ts",
    ],
  });
  put("ledger-types.ts", readFileSync(resolve(root, "scripts/verify/ledger-types.txt"), "utf8"));
  put("groups-types.ts", readFileSync(resolve(root, "scripts/verify/groups-types.txt"), "utf8"));
  put("storage-types.ts", readFileSync(resolve(root, "scripts/verify/storage-types.txt"), "utf8"));
  put(
    "primitives-types.ts",
    readFileSync(resolve(root, "scripts/verify/primitives-types.txt"), "utf8"),
  );
  put(
    "concord-types.ts",
    'import {createDocument,openDocument} from "@ternent/concord";\nimport {createStandardSystemProfile} from "@ternent/concord/system";\nimport {registerModel} from "@ternent/concord/testing";\nimport {generateIdentity} from "@ternent/armour";\nconst identity=await generateIdentity();if(!identity.ok)throw new Error();\nconst created=await createDocument({model:registerModel,system:createStandardSystemProfile(),identity:identity.value});if(!created.ok)throw new Error();\nawait created.value.dispatch("set",{value:"typed"});\n// @ts-expect-error unknown command names are rejected.\nawait created.value.dispatch("missing",{});\n// @ts-expect-error command payload types survive publishing.\nawait created.value.dispatch("set",{value:42});\nconst opened=await openDocument({bytes:created.value.export(),model:registerModel,system:createStandardSystemProfile(),signer:identity.value});\nawait opened.dispatch("set",{value:"typed"});\n// @ts-expect-error open retains model command types.\nawait opened.dispatch("set",{value:42});\n',
  );
  put(
    "index.html",
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Library consumer verification</title></head><body><main id="app"></main><script type="module" src="/src/main.ts"></script></body></html>',
  );
  put(
    "vite.config.ts",
    `import { defineConfig } from "vite-plus";
export default defineConfig({
  define: {
    __VUE_OPTIONS_API__: true,
    __VUE_PROD_DEVTOOLS__: false,
    __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false,
  },
  build: { target: "es2022", sourcemap: true },
  lint: {
    options: { typeAware: true, typeCheck: false },
    rules: { "typescript/no-floating-promises": "error" },
  },
  test: { include: ["test/**/*.test.ts"], passWithNoTests: false },
});
`,
  );
  put(
    "src/concord-proof.ts",
    readFileSync(resolve(root, "scripts/verify/concord-browser.txt"), "utf8"),
  );
  put("src/main.ts", readFileSync(resolve(root, "scripts/verify/browser-main.txt"), "utf8"));
  put(
    "src/style.css",
    ".consumer-counter { color: #13529b; font: inherit; padding: 0.5rem 1rem; }\n",
  );
  console.log(pnpm(["exec", "tsc6", "--noEmit", "-p", "tsconfig.json"]));
  checks.push(
    "five-library published declarations, browser consumer types and expected TypeScript failures",
  );
  console.log(pnpm(["exec", "vp", "build"]));
  checks.push(
    "plain Vite+ production build of a temporary Vue render consumer using installed candidates",
  );
  const browser = await chromium.launch({ headless: true });
  try {
    const app = await serve(join(consumer, "dist"));
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(15_000);
      /** @type {string[]} */ const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(app.url);
      const button = page.getByRole("button", { name: "Library consumer: 0" });
      await button.waitFor();
      await page.locator("#concord-proof").filter({ hasText: "Concord: hello browser" }).waitFor();
      assert.equal(
        await button.evaluate((element) => getComputedStyle(element).color),
        "rgb(19, 82, 155)",
      );
      await button.click();
      await page.getByRole("button", { name: "Library consumer: 1" }).waitFor();
      assert.equal((await page.request.get(`${app.url}/missing.js`)).status(), 404);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: resolve(root, "artifacts/browser.png") });
      await page.close();
      checks.push(
        "Chromium: standalone Ledger, Armour codecs, encrypted Concord and independent groups, storage, drafts, production CSS and Vue render interaction",
      );
    } finally {
      await app.close();
    }
  } finally {
    await browser.close();
  }
  put("feedback.ts", "Promise.resolve(1);\n");
  const lintFailure = spawnSync("pnpm", ["exec", "vp", "lint", "--type-aware", "feedback.ts"], {
    cwd: consumer,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  assert.notEqual(
    lintFailure.status,
    0,
    "A floating promise must fail the explicit typed lint rule",
  );
  assert.match(`${lintFailure.stdout}${lintFailure.stderr}`, /no-floating-promises/);
  put("bad-format.ts", "export const messy={a:1,b:2}");
  const formatFailure = spawnSync("pnpm", ["exec", "vp", "fmt", "--check", "bad-format.ts"], {
    cwd: consumer,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  assert.notEqual(formatFailure.status, 0, "Unformatted input must fail without modifying it");
  assert.equal(
    readFileSync(join(consumer, "bad-format.ts"), "utf8"),
    "export const messy={a:1,b:2}",
  );
  assert.match(`${formatFailure.stdout}${formatFailure.stderr}`, /bad-format.ts/);
  checks.push("explicit typed lint and read-only formatting propagate useful failures");
  put(
    "test/failure.test.ts",
    'import { expect, test } from "vite-plus/test";\ntest("intentional failure", () => expect(1).toBe(2));\n',
  );
  const failing = spawnSync("pnpm", ["exec", "vp", "test", "run"], {
    cwd: consumer,
    encoding: "utf8",
    env: { ...process.env, CI: "true" },
  });
  assert.notEqual(failing.status, 0, "A failing behavior test must exit nonzero");
  assert.match(`${failing.stdout}${failing.stderr}`, /intentional failure/);
  checks.push("an actual failing test propagates a failure exit status");
  for (const { file, sha256 } of Object.values(candidates))
    assert.equal(
      createHash("sha256").update(readFileSync(file)).digest("hex"),
      sha256,
      `Candidate changed: ${file}`,
    );
  checks.push("verified tarballs retain their recorded SHA-256 digests");
  writeFileSync(
    "artifacts/consumers.json",
    `${JSON.stringify({ sourceSha, candidates, installedCandidates, checks }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ candidates: Object.keys(candidates), checks }, null, 2));
} catch (error) {
  writeFileSync(
    "artifacts/consumers.json",
    `${JSON.stringify({ sourceSha, candidates, installedCandidates, checks, error: String(error), consumer }, null, 2)}\n`,
  );
  throw error;
} finally {
  await registry?.close();
  rmSync(consumer, { recursive: true, force: true });
}

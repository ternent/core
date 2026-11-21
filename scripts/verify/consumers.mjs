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
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { extname, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { workspacePackages } from "./workspace.mjs";

const root = process.cwd();
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
/** @type {Record<string, {file: string, sha256: string}>} */
const candidates = {};
/** @type {string[]} */
const checks = [];

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
    const result = JSON.parse(
      pnpm(["pack", "--json", "--pack-destination", candidateDir], entry.path),
    );
    const packed = Array.isArray(result) ? result[0] : result;
    const file = resolve(candidateDir, packed.filename);
    assert(existsSync(file), `Missing packed file: ${file}`);
    console.log(pnpm(["exec", "publint", file, "--strict"], root));
    candidates[entry.name] = {
      file,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  }
  checks.push("all five exact library tarballs pass strict publint validation");
  const dependencies = Object.fromEntries(
    Object.entries(candidates).map(([name, data]) => [name, `file:${data.file}`]),
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
  const overrides = Object.fromEntries([
    ...Object.keys(candidates).map((name) => [name, dependencies[name]]),
    ["@types/node", rootManifest.devDependencies["@types/node"]],
  ]);
  put(
    "pnpm-workspace.yaml",
    `packages: []\nallowBuilds: {}\noverrides:\n${Object.entries(overrides)
      .map(([name, version]) => `  ${JSON.stringify(name)}: ${JSON.stringify(version)}`)
      .join("\n")}\n`,
  );
  put(".npmrc", "registry=https://registry.npmjs.org/\n");
  console.log(
    pnpm([
      "install",
      "--prefer-offline",
      "--ignore-scripts",
      "--store-dir",
      resolve(root, ".pnpm-store"),
    ]),
  );
  checks.push(
    "isolated installation from exact candidate tarballs with explicit candidate overrides",
  );
  for (const name of [
    "owner.document.json",
    "owner.expected.json",
    "groups.removed.document.json",
    "groups.readmitted.document.json",
    "groups.expected.json",
  ])
    cpSync(resolve(root, "docs/concord/vectors", name), join(consumer, name));
  cpSync(resolve(root, "docs/seal/vectors/proof.v2.json"), join(consumer, "seal-proof.v2.json"));
  cpSync(
    resolve(root, "packages/ledger/test/vectors/signed-log.json"),
    join(consumer, "ledger-signed-log.json"),
  );
  put("ledger.mjs", readFileSync(resolve(root, "scripts/verify/ledger-consumer.txt"), "utf8"));
  put("payload.mjs", readFileSync(resolve(root, "scripts/verify/payload-consumer.txt"), "utf8"));
  put("seal.mjs", readFileSync(resolve(root, "scripts/verify/seal-consumer.txt"), "utf8"));
  put(
    "seal-isolation.mjs",
    readFileSync(resolve(root, "scripts/verify/seal-isolation.txt"), "utf8"),
  );
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
    console.log(execFileSync(executable, ["seal.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(
      execFileSync(executable, ["seal-isolation.mjs"], { cwd: consumer, encoding: "utf8" }),
    );
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
    `Seal installed public paths, fixed signature, artifact encryption, CLI/Action sequence, exits and Node-free library import graph on ${versions}`,
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
      "seal-types.ts",
      "ledger-types.ts",
      "src/**/*.ts",
      "vite.config.ts",
      "feedback.ts",
    ],
  });
  put("ledger-types.ts", readFileSync(resolve(root, "scripts/verify/ledger-types.txt"), "utf8"));
  put("seal-types.ts", readFileSync(resolve(root, "scripts/verify/seal-types.txt"), "utf8"));
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
    "public/seal-proof.v2.json",
    readFileSync(resolve(root, "docs/seal/vectors/proof.v2.json"), "utf8"),
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
        "Chromium: standalone Ledger, Armour codecs, fixed Seal proof/artifact, encrypted Concord and independent groups, storage, drafts, production CSS and Vue render interaction",
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
  writeFileSync("artifacts/consumers.json", `${JSON.stringify({ candidates, checks }, null, 2)}\n`);
  console.log(JSON.stringify({ candidates: Object.keys(candidates), checks }, null, 2));
} catch (error) {
  writeFileSync(
    "artifacts/consumers.json",
    `${JSON.stringify({ candidates, checks, error: String(error), consumer }, null, 2)}\n`,
  );
  throw error;
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

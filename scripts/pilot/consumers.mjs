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
import { validatePackage } from "@ternent/tooling/validation";
import { readManifest, workspacePackages } from "./workspace.mjs";

const root = process.cwd();
const rootManifest = /** @type {{devDependencies: Record<string, string>}} */ (
  JSON.parse(readFileSync("package.json", "utf8"))
);
const packages = workspacePackages();
mkdirSync("artifacts", { recursive: true });
const candidateDir = mkdtempSync(resolve("artifacts", "pilot-candidates-"));
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

/** Local artifact routing proof; production behavior still requires a Cloudflare deployment test.
 * @param {string} directory @param {boolean} spa
 */
async function serve(directory, spa) {
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
    if (relative(directory, file).startsWith(`..${sep}`)) {
      response.writeHead(400).end();
      return;
    }
    if (existsSync(file) && statSync(file).isDirectory()) file = join(file, "index.html");
    if (!existsSync(file) && !extname(file) && existsSync(`${file}.html`)) file += ".html";
    if (!existsSync(file)) {
      if (spa && !extname(pathname)) file = join(directory, "index.html");
      else {
        response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
        return;
      }
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
    assert.deepEqual(validatePackage(entry.path, { built: true }), [], `artifact: ${entry.name}`);
    const profile = readManifest(entry.path).ternent?.profile;
    if (profile === "vue-app" || profile === "docs-app") continue;
    const result = JSON.parse(
      pnpm(["pack", "--json", "--pack-destination", candidateDir], entry.path),
    );
    const packed = Array.isArray(result) ? result[0] : result;
    const file = resolve(candidateDir, packed.filename);
    assert(existsSync(file), `Missing packed file: ${file}`);
    candidates[entry.name] = {
      file,
      sha256: createHash("sha256").update(readFileSync(file)).digest("hex"),
    };
  }
  checks.push("all declared package/app artifact targets validated");
  const dependencies = Object.fromEntries(
    Object.entries(candidates).map(([name, data]) => [name, `file:${data.file}`]),
  );
  for (const name of [
    "vite-plus",
    "typescript",
    "vue",
    "vue-tsc",
    "@types/node",
    "@volar/language-service",
    "unplugin-vue",
    "@vitejs/plugin-vue",
  ])
    dependencies[name] = rootManifest.devDependencies[name];
  put("package.json", {
    name: "@ternent-consumers/pilot",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies,
    pnpm: {
      overrides: Object.fromEntries([
        ...Object.keys(candidates).map((name) => [name, dependencies[name]]),
        ["@types/node", rootManifest.devDependencies["@types/node"]],
      ]),
    },
  });
  put(
    "pnpm-workspace.yaml",
    'packages: []\nonlyBuiltDependencies: []\npeerDependencyRules:\n  allowedVersions:\n    vite: "1.3.0"\n',
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
  for (const name of ["owner.document.json", "owner.expected.json"])
    cpSync(resolve(root, "docs/concord/vectors", name), join(consumer, name));
  put("concord.mjs", readFileSync(resolve(root, "scripts/pilot/concord-consumer.txt"), "utf8"));
  put(
    "primitives.mjs",
    readFileSync(resolve(root, "scripts/pilot/primitives-consumer.txt"), "utf8"),
  );
  put(
    "protocol-isolation.mjs",
    readFileSync(resolve(root, "scripts/pilot/protocol-isolation.txt"), "utf8"),
  );
  const node22 =
    process.env.CONCORD_NODE22 ?? resolve(process.execPath, "../../../v22.18.0/bin/node");
  assert(
    existsSync(node22),
    "Install Node 22.18.0 or set CONCORD_NODE22 to its executable for the supported-runtime consumer",
  );
  assert.match(execFileSync(node22, ["--version"], { encoding: "utf8" }), /^v22\./);
  for (const executable of [node22, process.execPath]) {
    console.log(execFileSync(executable, ["primitives.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(execFileSync(executable, ["concord.mjs"], { cwd: consumer, encoding: "utf8" }));
    console.log(
      execFileSync(executable, ["protocol-isolation.mjs"], { cwd: consumer, encoding: "utf8" }),
    );
  }
  checks.push(
    "Identity, Armour and all Concord subpaths: real lifecycle and fixed vectors on Node 22/24; protocol import isolation",
  );
  checks.push(
    "Identity mnemonic/serialization/signing and init-free Armour helper contracts on Node 22/24",
  );
  const output = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      'import { greet } from "@ternent-fixtures/library"; import { formatCount } from "@ternent-fixtures/library/format"; import { renderGreeting } from "@ternent-fixtures/cli"; import { defineLibrary } from "@ternent/tooling/config"; import { validateManifest } from "@ternent/tooling/validation"; if (greet("Concord") !== "Hello, Concord" || formatCount(2) !== "2 items" || renderGreeting("CLI") !== "Hello, CLI" || !defineLibrary({ entry: { index: "src/index.ts" } }).pack || validateManifest({}).length === 0) throw new Error("public imports failed"); console.log("public imports passed");',
    ],
    { cwd: consumer, encoding: "utf8" },
  );
  assert.equal(output.trim(), "public imports passed");
  assert.equal(
    execFileSync(join(consumer, "node_modules/.bin/ternent-fixture"), ["Concord"], {
      cwd: consumer,
      encoding: "utf8",
    }).trim(),
    "Hello, Concord",
  );
  checks.push("public imports/subpath/tooling/CLI behavior with no import side effects");
  put("tsconfig.json", {
    extends: "@ternent/tooling/tsconfig/library.json",
    include: [
      "consumer.ts",
      "config-contract.ts",
      "feedback.ts",
      "concord-types.ts",
      "primitives-types.ts",
    ],
  });
  put(
    "primitives-types.ts",
    readFileSync(resolve(root, "scripts/pilot/primitives-types.txt"), "utf8"),
  );
  put(
    "consumer.ts",
    'import { greet } from "@ternent-fixtures/library";\nimport { formatCount } from "@ternent-fixtures/library/format";\nimport { CounterButton } from "@ternent-fixtures/vue-library";\nconst message: string = greet("typed");\nconst count: string = formatCount(1);\ntype Props = InstanceType<typeof CounterButton>["$props"];\nconst props: Props = { label: message };\n// @ts-expect-error A published command argument retains its type.\ngreet(42);\n// @ts-expect-error Vue declarations retain required prop types.\nconst invalid: Props = { label: 42 };\nvoid [message, count, props, invalid];\n',
  );
  put(
    "config-contract.ts",
    'import { defineLibrary } from "@ternent/tooling/config";\nimport type { UserConfig } from "vite-plus";\nconst config: UserConfig = defineLibrary({ entry: { index: "src/index.ts" } });\n// @ts-expect-error The public build input rejects non-string entries.\ndefineLibrary({ entry: { index: 42 } });\nvoid config;\n',
  );
  put(
    "concord-types.ts",
    'import {createDocument,openDocument} from "@ternent/concord";\nimport {createStandardSystemProfile} from "@ternent/concord/system";\nimport {registerModel} from "@ternent/concord/testing";\nimport {generateIdentity} from "@ternent/armour";\nconst identity=await generateIdentity();if(!identity.ok)throw new Error();\nconst created=await createDocument({model:registerModel,system:createStandardSystemProfile(),identity:identity.value});if(!created.ok)throw new Error();\nawait created.value.dispatch("set",{value:"typed"});\n// @ts-expect-error unknown command names are rejected.\nawait created.value.dispatch("missing",{});\n// @ts-expect-error command payload types survive publishing.\nawait created.value.dispatch("set",{value:42});\nconst opened=await openDocument({bytes:created.value.export(),model:registerModel,system:createStandardSystemProfile(),signer:identity.value});\nawait opened.dispatch("set",{value:"typed"});\n// @ts-expect-error open retains model command types.\nawait opened.dispatch("set",{value:42});\n',
  );
  console.log(pnpm(["exec", "tsc", "--noEmit", "-p", "tsconfig.json"]));
  checks.push("published declarations, Vue props and expected TypeScript failures");
  put("src/index.ts", 'export { greet } from "@ternent-fixtures/library";\n');
  put(
    "vite.config.ts",
    'import { defineLibrary } from "@ternent/tooling/config";\nexport default defineLibrary({ entry: { index: "src/index.ts" } });\n',
  );
  console.log(pnpm(["exec", "vp", "pack"]));
  checks.push("portable tooling builds a new library outside the workspace");
  cpSync(resolve(root, "fixtures/tooling-profiles/app/src"), join(consumer, "src"), {
    recursive: true,
  });
  cpSync(resolve(root, "fixtures/tooling-profiles/app/index.html"), join(consumer, "index.html"));
  put(
    "vite.config.ts",
    'import { defineApp } from "@ternent/tooling/config";\nexport default defineApp();\n',
  );
  put(
    "src/concord-proof.ts",
    readFileSync(resolve(root, "scripts/pilot/concord-browser.txt"), "utf8"),
  );
  put(
    "src/main.ts",
    readFileSync(join(consumer, "src/main.ts"), "utf8") +
      '\nimport {proveConcord} from "./concord-proof.js";\nvoid proveConcord();\n',
  );
  console.log(pnpm(["exec", "vp", "build"]));
  checks.push("portable tooling builds a Vue app against installed candidate libraries");
  const browser = await chromium.launch({ headless: true });
  try {
    const app = await serve(join(consumer, "dist"), true);
    const docs = await serve(
      resolve(root, "fixtures/tooling-profiles/docs/site/.vitepress/dist"),
      false,
    );
    try {
      const page = await browser.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(15_000);
      /** @type {string[]} */ const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.goto(`${app.url}/boards/example`);
      const button = page.getByRole("button", { name: "Hello, Concord: 0" });
      await button.waitFor();
      await page.locator("#concord-proof").filter({ hasText: "Concord: hello browser" }).waitFor();
      assert.equal(
        await button.evaluate((element) => getComputedStyle(element).color),
        "rgb(19, 82, 155)",
      );
      await button.click();
      await page.getByRole("button", { name: "Hello, Concord: 1" }).waitFor();
      assert.equal((await page.request.get(`${app.url}/missing.js`)).status(), 404);
      await page.screenshot({ path: resolve(root, "artifacts/pilot-browser.png") });
      await page.goto(docs.url);
      await page.getByRole("heading", { name: /^Ternent tooling pilot/, level: 1 }).waitFor();
      assert.equal((await page.request.get(`${docs.url}/absent.html`)).status(), 404);
      assert.deepEqual(errors, []);
      await page.close();
      checks.push(
        "Chromium: encrypted Concord lifecycle, production CSS, Vue interaction, deep navigation, docs and missing-asset/404 behavior",
      );
    } finally {
      await app.close();
      await docs.close();
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
  assert.notEqual(lintFailure.status, 0, "A floating promise must fail the portable lint policy");
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
  checks.push("portable typed lint and read-only formatting propagate useful failures");
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
  writeFileSync(
    "artifacts/pilot-consumers.json",
    `${JSON.stringify({ candidates, checks }, null, 2)}\n`,
  );
  console.log(JSON.stringify({ candidates: Object.keys(candidates), checks }, null, 2));
} catch (error) {
  writeFileSync(
    "artifacts/pilot-consumers.json",
    `${JSON.stringify({ candidates, checks, error: String(error), consumer }, null, 2)}\n`,
  );
  throw error;
} finally {
  rmSync(consumer, { recursive: true, force: true });
}

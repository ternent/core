import { readFileSync } from "node:fs";
import { readManifest, workspacePackages } from "./workspace.mjs";

const expectedNode = readFileSync(".node-version", "utf8").trim();
if (process.versions.node !== expectedNode)
  throw new Error(`TOOLCHAIN_MISMATCH: use Node ${expectedNode}`);
const root = readManifest(process.cwd());
if (!root.private) throw new Error("CONTRACT_INVALID: workspace root must stay private");
const actualPnpm = process.env.npm_config_user_agent?.split(" ")[0];
const expectedPnpm = root.packageManager?.replace("@", "/");
if (!actualPnpm || actualPnpm !== expectedPnpm)
  throw new Error(`TOOLCHAIN_MISMATCH: use ${root.packageManager}`);
if (readFileSync(".nvmrc", "utf8").trim() !== expectedNode)
  throw new Error("TOOLCHAIN_MISMATCH: Node version files disagree");
const packages = workspacePackages();
const names = new Set(packages.map((entry) => entry.name));
if (names.size !== packages.length || packages.length === 0)
  throw new Error("CONTRACT_INVALID: empty or duplicate workspace");
const expected = [
  "@ternent/identity",
  "@ternent/armour",
  "@ternent/ledger",
  "@ternent/concord",
  "@ternent/seal",
];
if (names.size !== expected.length || expected.some((name) => !names.has(name)))
  throw new Error(
    "CONTRACT_INVALID: active workspace must contain exactly the five public libraries",
  );
/** @type {{code: string, path: string, message: string}[]} */
const findings = [];
for (const entry of packages) {
  const manifest = readManifest(entry.path);
  if (manifest.private || manifest.type !== "module" || manifest.publishConfig?.access !== "public")
    findings.push({
      code: "PUBLIC_ESM_REQUIRED",
      path: entry.name,
      message: "Libraries must declare public ESM outputs",
    });
  for (const name of ["fmt:check", "lint", "typecheck", "test", "build", "check:artifact", "check"])
    if (!manifest.scripts?.[name])
      findings.push({ code: "SCRIPT_MISSING", path: entry.name, message: name });
  for (const name of [
    "prepare",
    "prepack",
    "postpack",
    "prepublish",
    "prepublishOnly",
    "publish",
    "postpublish",
  ])
    if (manifest.scripts?.[name])
      findings.push({ code: "LIFECYCLE_FORBIDDEN", path: entry.name, message: name });
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) {
    if (/^(file:|link:)/.test(range))
      findings.push({ code: "LOCAL_RUNTIME_DEPENDENCY", path: entry.name, message: name });
    if (names.has(name) && !range.startsWith("workspace:"))
      findings.push({ code: "WORKSPACE_RANGE_REQUIRED", path: entry.name, message: name });
  }
}
console.log(
  JSON.stringify(
    {
      scope: "active-workspace",
      packages: [...names],
      findings,
    },
    null,
    2,
  ),
);
if (findings.length) process.exitCode = 1;

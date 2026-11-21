import { spawnSync } from "node:child_process";
import { relative } from "node:path";
import { workspacePackages } from "./workspace.mjs";

const [command, ...options] = process.argv.slice(2);
if (command !== "fmt" && command !== "lint") throw new Error("Expected fmt or lint");
const paths = [
  ...workspacePackages().map((entry) => relative(process.cwd(), entry.path)),
  "scripts/verify",
  "scripts/release",
  "vite.config.ts",
  "vite.config.base.ts",
];
if (command === "fmt")
  paths.push(
    "package.json",
    "pnpm-workspace.yaml",
    "tsconfig.json",
    "tsconfig.base.json",
    ".github",
    ".changeset",
    "README.md",
    "CONTRIBUTING.md",
    "renovate.json",
    "docs/engineering/repository-hygiene.md",
  );
const result = spawnSync("vp", [command, ...options, ...paths], { stdio: "inherit" });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;

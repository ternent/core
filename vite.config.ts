import { defineWorkspace } from "@ternent/tooling/config";
import { relative } from "node:path";
import { workspacePackages } from "./scripts/verify/workspace.mjs";

export default defineWorkspace({
  testInclude: workspacePackages().map(
    (entry) => `${relative(process.cwd(), entry.path)}/test/**/*.test.{ts,mjs}`,
  ),
  verifyCommand: "node scripts/verify/check.mjs",
});

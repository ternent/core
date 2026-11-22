import { defineConfig } from "vite-plus";
import { relative } from "node:path";
import { workspacePackages } from "./scripts/verify/workspace.mjs";
import base from "./vite.config.base.js";

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    include: workspacePackages().map(
      (entry) => `${relative(process.cwd(), entry.path)}/test/**/*.test.{ts,mjs}`,
    ),
  },
});

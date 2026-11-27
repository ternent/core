import { defineConfig } from "vite-plus";
import base from "../../vite.config.base.js";

export default defineConfig({
  ...base,
  pack: {
    ...base.pack,
    platform: "node",
    entry: { index: "src/index.ts", cli: "src/cli.ts" },
  },
});

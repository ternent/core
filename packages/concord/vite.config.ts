import { defineConfig } from "vite-plus";
import base from "../../vite.config.base.js";

export default defineConfig({
  ...base,
  pack: {
    ...base.pack,
    entry: {
      index: "src/index.ts",
      "protocol/index": "src/protocol/index.ts",
      "system/index": "src/system/index.ts",
      "testing/index": "src/testing/index.ts",
    },
  },
});

import { defineConfig } from "vite-plus";
import base from "../../vite.config.base.js";

export default defineConfig({
  ...base,
  pack: {
    ...base.pack,
    platform: "node",
    entry: {
      index: "src/index.ts",
      proof: "src/proof.ts",
      artifact: "src/artifact.ts",
      manifest: "src/manifest.ts",
      crypto: "src/crypto.ts",
      errors: "src/errors.ts",
      cli: "src/cli.ts",
    },
  },
});

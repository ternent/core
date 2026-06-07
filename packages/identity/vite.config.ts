import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2020",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ternentIdentityV2",
      fileName: "index",
    },
    rollupOptions: {},
  },
  test: {
    environment: "node",
  },
});

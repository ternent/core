import { resolve } from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  build: {
    target: "es2022",
    lib: {
      entry: resolve(__dirname, "src/index.ts"),
      name: "ternentWorkspace",
      fileName: "index",
    },
    rollupOptions: {
      external: [
        "@ternent/armour",
        "@ternent/concord",
        "@ternent/identity",
        "@ternent/ledger",
      ],
    },
  },
  test: {
    environment: "node",
  },
});

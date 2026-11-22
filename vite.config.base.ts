import type { UserConfig } from "vite-plus";

export default {
  fmt: {
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "artifacts/**",
      ".pnpm-store/**",
      "**/*.timestamp-*.mjs",
    ],
  },
  lint: {
    ignorePatterns: [
      "**/dist/**",
      "**/node_modules/**",
      "artifacts/**",
      ".pnpm-store/**",
      "**/*.timestamp-*.mjs",
    ],
    options: { typeAware: true, typeCheck: false },
    rules: { "typescript/no-floating-promises": "error" },
  },
  pack: {
    format: ["esm"],
    platform: "neutral",
    target: "es2022",
    dts: true,
    sourcemap: true,
    minify: false,
    outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
  },
  test: { include: ["test/**/*.test.{ts,mjs}"], passWithNoTests: false },
} satisfies UserConfig;

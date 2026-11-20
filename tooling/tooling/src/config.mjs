/** @typedef {import('../types/config.js').LibraryOptions} LibraryOptions */
/** @typedef {import('../types/config.js').LibraryConfig} LibraryConfig */
/** @typedef {import('vite-plus').UserConfig} UserConfig */

/** Shared policy travels with each profile, including outside this repository.
 * @returns {Pick<UserConfig, 'fmt' | 'lint'>}
 */
function policy() {
  return {
    fmt: {
      ignorePatterns: [
        "artifacts/**",
        "**/dist/**",
        "**/node_modules/**",
        ".pnpm-store/**",
        "**/.vitepress/cache/**",
        "**/legacy/**",
        "**/*.timestamp-*.mjs",
      ],
    },
    lint: {
      ignorePatterns: [
        "**/dist/**",
        "artifacts/**",
        "**/node_modules/**",
        ".pnpm-store/**",
        "**/.vitepress/cache/**",
        "**/legacy/**",
        "**/*.timestamp-*.mjs",
      ],
      options: { typeAware: true, typeCheck: false },
      rules: { "typescript/no-floating-promises": "error" },
    },
  };
}

/** Task dependencies prepare public sibling outputs without source aliases. */
function tasks() {
  /** @type {{task: string, from: Array<'dependencies' | 'peerDependencies'>}[]} */
  const dependencies = [{ task: "build-ready", from: ["dependencies", "peerDependencies"] }];
  return {
    "build-ready": { command: "pnpm run build", dependsOn: dependencies, cache: false },
    "types-ready": { command: "pnpm run typecheck", dependsOn: dependencies, cache: false },
    "tests-ready": { command: "pnpm run test", dependsOn: dependencies, cache: false },
    "lint-ready": { command: "pnpm run lint", dependsOn: dependencies, cache: false },
    verify: {
      command: "pnpm run check:artifact",
      dependsOn: ["build-ready", "types-ready", "tests-ready", "lint-ready", "fmt:check"],
      cache: false,
    },
  };
}

/** @param {LibraryOptions} options @returns {LibraryConfig} */
export function defineLibrary(options) {
  if (
    !options ||
    !options.entry ||
    Array.isArray(options.entry) ||
    typeof options.entry !== "object" ||
    Object.keys(options.entry).length === 0 ||
    Object.values(options.entry).some((entry) => typeof entry !== "string" || entry.length === 0) ||
    Object.keys(options).some((key) => key !== "entry")
  ) {
    throw new TypeError("defineLibrary requires only an explicit entry map");
  }
  return {
    ...policy(),
    pack: {
      entry: options.entry,
      format: ["esm"],
      platform: "neutral",
      target: "es2022",
      dts: true,
      sourcemap: true,
      minify: false,
      outExtensions: () => ({ js: ".js", dts: ".d.ts" }),
    },
    test: { include: ["test/**/*.test.{ts,mjs}"], passWithNoTests: false },
    run: { tasks: tasks() },
  };
}

/** @param {LibraryOptions} options @returns {LibraryConfig} */
export function defineCliLibrary(options) {
  const config = defineLibrary(options);
  return { ...config, pack: { ...config.pack, platform: "node" } };
}

/**
 * Optional integration peers expose types for unrelated bundlers. Keep those behind
 * this runtime adapter instead of making every tooling consumer install those backends.
 * @param {string} specifier
 * @param {unknown} options
 * @returns {Promise<import('vite-plus').Plugin>}
 */
async function loadPlugin(specifier, options) {
  const namespace = await import(specifier);
  if (typeof namespace.default !== "function")
    throw new TypeError(`Missing plugin factory: ${specifier}`);
  const plugin = namespace.default(options);
  if (!plugin || typeof plugin.name !== "string")
    throw new TypeError(`Invalid plugin: ${specifier}`);
  return plugin;
}

/** @param {LibraryOptions} options @returns {Promise<LibraryConfig>} */
export async function defineVueLibrary(options) {
  const vue = await loadPlugin("unplugin-vue/rolldown", { isProduction: true });
  const config = defineLibrary(options);
  return {
    ...config,
    plugins: [await loadPlugin("@vitejs/plugin-vue", {})],
    pack: {
      ...config.pack,
      plugins: [vue],
      dts: { vue: true },
    },
  };
}

/** @returns {Promise<UserConfig>} */
export async function defineApp() {
  const vue = await loadPlugin("@vitejs/plugin-vue", {});
  return {
    ...policy(),
    plugins: [vue],
    build: { target: "es2022", sourcemap: true },
    test: { include: ["test/**/*.test.ts"], passWithNoTests: false },
    run: { tasks: tasks() },
  };
}

/** Gate configuration only: VitePress owns its application build. @returns {UserConfig} */
export function defineDocs() {
  return {
    ...policy(),
    test: { include: ["test/**/*.test.ts"], passWithNoTests: false },
    run: { tasks: tasks() },
  };
}

/** @returns {Promise<UserConfig>} */
export async function defineWorkspace() {
  return {
    plugins: [await loadPlugin("@vitejs/plugin-vue", {})],
    ...policy(),
    test: {
      include: [
        "tooling/tooling/test/**/*.test.mjs",
        "packages/identity/test/**/*.test.ts",
        "packages/armour/test/**/*.test.ts",
        "packages/concord/test/**/*.test.ts",
        "apps/handshake/test/**/*.test.ts",
        "fixtures/tooling-profiles/*/test/**/*.test.ts",
      ],
      passWithNoTests: false,
    },
    run: {
      enablePrePostScripts: false,
      tasks: { verify: { command: "node scripts/pilot/check.mjs", cache: false } },
    },
  };
}

/** Bootstrap tooling has no compiled outputs. @returns {UserConfig} */
export function defineTooling() {
  return {
    ...policy(),
    test: { include: ["test/**/*.test.mjs"], passWithNoTests: false },
    run: { tasks: tasks() },
  };
}

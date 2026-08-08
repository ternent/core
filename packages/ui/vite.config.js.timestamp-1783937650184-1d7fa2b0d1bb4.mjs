// vite.config.js
import { resolve } from "path";
import { defineConfig } from "file:///Users/sam/dev/ternent/core/node_modules/.pnpm/vite@7.3.3_@types+node@24.12.4_jiti@2.7.0_lightningcss@1.32.0/node_modules/vite/dist/node/index.js";
import vue from "file:///Users/sam/dev/ternent/core/node_modules/.pnpm/@vitejs+plugin-vue@4.6.2_vite@7.3.3_@types+node@24.12.4_jiti@2.7.0_lightningcss@1.32.0__vue@3.5.35_typescript@5.9.3_/node_modules/@vitejs/plugin-vue/dist/index.mjs";
import tailwindcss from "file:///Users/sam/dev/ternent/core/node_modules/.pnpm/@tailwindcss+vite@4.3.0_vite@7.3.3_@types+node@24.12.4_jiti@2.7.0_lightningcss@1.32.0_/node_modules/@tailwindcss/vite/dist/index.mjs";
var __vite_injected_original_dirname = "/Users/sam/dev/ternent/core/packages/ui";
var vite_config_default = defineConfig({
  output: {
    exports: "named"
  },
  build: {
    lib: {
      entry: {
        primitives: resolve(__vite_injected_original_dirname, "src/primitives/index.ts"),
        patterns: resolve(__vite_injected_original_dirname, "src/patterns/index.ts")
      }
    },
    rollupOptions: {
      external: ["vue", "@vueuse/core", "luxon"]
    },
    target: "esnext"
  },
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "./src")
    }
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["src/**/*.test.ts"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvdWlcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9zYW0vZGV2L3Rlcm5lbnQvY29yZS9wYWNrYWdlcy91aS92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvdWkvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyByZXNvbHZlIH0gZnJvbSBcInBhdGhcIjtcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgdnVlIGZyb20gXCJAdml0ZWpzL3BsdWdpbi12dWVcIjtcbmltcG9ydCB0YWlsd2luZGNzcyBmcm9tIFwiQHRhaWx3aW5kY3NzL3ZpdGVcIjtcblxuLy8gaHR0cHM6Ly92aXRlanMuZGV2L2NvbmZpZy9cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIG91dHB1dDoge1xuICAgIGV4cG9ydHM6IFwibmFtZWRcIixcbiAgfSxcbiAgYnVpbGQ6IHtcbiAgICBsaWI6IHtcbiAgICAgIGVudHJ5OiB7XG4gICAgICAgIHByaW1pdGl2ZXM6IHJlc29sdmUoX19kaXJuYW1lLCBcInNyYy9wcmltaXRpdmVzL2luZGV4LnRzXCIpLFxuICAgICAgICBwYXR0ZXJuczogcmVzb2x2ZShfX2Rpcm5hbWUsIFwic3JjL3BhdHRlcm5zL2luZGV4LnRzXCIpLFxuICAgICAgfSxcbiAgICB9LFxuXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgZXh0ZXJuYWw6IFtcInZ1ZVwiLCBcIkB2dWV1c2UvY29yZVwiLCBcImx1eG9uXCJdLFxuICAgIH0sXG4gICAgdGFyZ2V0OiBcImVzbmV4dFwiLFxuICB9LFxuICBwbHVnaW5zOiBbdnVlKCksIHRhaWx3aW5kY3NzKCldLFxuICByZXNvbHZlOiB7XG4gICAgYWxpYXM6IHtcbiAgICAgIFwiQFwiOiByZXNvbHZlKF9fZGlybmFtZSwgXCIuL3NyY1wiKSxcbiAgICB9LFxuICB9LFxuICB0ZXN0OiB7XG4gICAgZW52aXJvbm1lbnQ6IFwianNkb21cIixcbiAgICBnbG9iYWxzOiB0cnVlLFxuICAgIGluY2x1ZGU6IFtcInNyYy8qKi8qLnRlc3QudHNcIl0sXG4gIH0sXG59KTtcbiJdLAogICJtYXBwaW5ncyI6ICI7QUFBdVMsU0FBUyxlQUFlO0FBQy9ULFNBQVMsb0JBQW9CO0FBQzdCLE9BQU8sU0FBUztBQUNoQixPQUFPLGlCQUFpQjtBQUh4QixJQUFNLG1DQUFtQztBQU16QyxJQUFPLHNCQUFRLGFBQWE7QUFBQSxFQUMxQixRQUFRO0FBQUEsSUFDTixTQUFTO0FBQUEsRUFDWDtBQUFBLEVBQ0EsT0FBTztBQUFBLElBQ0wsS0FBSztBQUFBLE1BQ0gsT0FBTztBQUFBLFFBQ0wsWUFBWSxRQUFRLGtDQUFXLHlCQUF5QjtBQUFBLFFBQ3hELFVBQVUsUUFBUSxrQ0FBVyx1QkFBdUI7QUFBQSxNQUN0RDtBQUFBLElBQ0Y7QUFBQSxJQUVBLGVBQWU7QUFBQSxNQUNiLFVBQVUsQ0FBQyxPQUFPLGdCQUFnQixPQUFPO0FBQUEsSUFDM0M7QUFBQSxJQUNBLFFBQVE7QUFBQSxFQUNWO0FBQUEsRUFDQSxTQUFTLENBQUMsSUFBSSxHQUFHLFlBQVksQ0FBQztBQUFBLEVBQzlCLFNBQVM7QUFBQSxJQUNQLE9BQU87QUFBQSxNQUNMLEtBQUssUUFBUSxrQ0FBVyxPQUFPO0FBQUEsSUFDakM7QUFBQSxFQUNGO0FBQUEsRUFDQSxNQUFNO0FBQUEsSUFDSixhQUFhO0FBQUEsSUFDYixTQUFTO0FBQUEsSUFDVCxTQUFTLENBQUMsa0JBQWtCO0FBQUEsRUFDOUI7QUFDRixDQUFDOyIsCiAgIm5hbWVzIjogW10KfQo=

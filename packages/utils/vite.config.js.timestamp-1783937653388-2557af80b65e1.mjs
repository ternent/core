// vite.config.js
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "file:///Users/sam/dev/ternent/core/node_modules/.pnpm/vite@2.9.18/node_modules/vite/dist/node/index.js";
var __vite_injected_original_import_meta_url = "file:///Users/sam/dev/ternent/core/packages/utils/vite.config.js";
var configDir = dirname(fileURLToPath(__vite_injected_original_import_meta_url));
var vite_config_default = defineConfig({
  output: {
    exports: "named"
  },
  build: {
    outDir: "dist",
    minify: false,
    lib: {
      entry: resolve(configDir, "src/index.ts"),
      name: "ternent-utils",
      fileName: "utils",
      formats: ["es"]
    },
    rollupOptions: {
      output: {
        format: "es",
        entryFileNames: "utils.es.js"
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvdXRpbHNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfZmlsZW5hbWUgPSBcIi9Vc2Vycy9zYW0vZGV2L3Rlcm5lbnQvY29yZS9wYWNrYWdlcy91dGlscy92aXRlLmNvbmZpZy5qc1wiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9pbXBvcnRfbWV0YV91cmwgPSBcImZpbGU6Ly8vVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvdXRpbHMvdml0ZS5jb25maWcuanNcIjtpbXBvcnQgeyBkaXJuYW1lLCByZXNvbHZlIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgZmlsZVVSTFRvUGF0aCB9IGZyb20gXCJub2RlOnVybFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcblxuY29uc3QgY29uZmlnRGlyID0gZGlybmFtZShmaWxlVVJMVG9QYXRoKGltcG9ydC5tZXRhLnVybCkpO1xuXG4vLyBodHRwczovL3ZpdGVqcy5kZXYvY29uZmlnL1xuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgb3V0cHV0OiB7XG4gICAgZXhwb3J0czogXCJuYW1lZFwiLFxuICB9LFxuICBidWlsZDoge1xuICAgIG91dERpcjogXCJkaXN0XCIsXG4gICAgbWluaWZ5OiBmYWxzZSxcbiAgICBsaWI6IHtcbiAgICAgIGVudHJ5OiByZXNvbHZlKGNvbmZpZ0RpciwgXCJzcmMvaW5kZXgudHNcIiksXG4gICAgICBuYW1lOiBcInRlcm5lbnQtdXRpbHNcIixcbiAgICAgIGZpbGVOYW1lOiBcInV0aWxzXCIsXG4gICAgICBmb3JtYXRzOiBbXCJlc1wiXSxcbiAgICB9LFxuICAgIHJvbGx1cE9wdGlvbnM6IHtcbiAgICAgIG91dHB1dDoge1xuICAgICAgICBmb3JtYXQ6IFwiZXNcIixcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6IFwidXRpbHMuZXMuanNcIixcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUFnVCxTQUFTLFNBQVMsZUFBZTtBQUNqVixTQUFTLHFCQUFxQjtBQUM5QixTQUFTLG9CQUFvQjtBQUYrSixJQUFNLDJDQUEyQztBQUk3TyxJQUFNLFlBQVksUUFBUSxjQUFjLHdDQUFlLENBQUM7QUFHeEQsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsUUFBUTtBQUFBLElBQ04sU0FBUztBQUFBLEVBQ1g7QUFBQSxFQUNBLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUNSLFFBQVE7QUFBQSxJQUNSLEtBQUs7QUFBQSxNQUNILE9BQU8sUUFBUSxXQUFXLGNBQWM7QUFBQSxNQUN4QyxNQUFNO0FBQUEsTUFDTixVQUFVO0FBQUEsTUFDVixTQUFTLENBQUMsSUFBSTtBQUFBLElBQ2hCO0FBQUEsSUFDQSxlQUFlO0FBQUEsTUFDYixRQUFRO0FBQUEsUUFDTixRQUFRO0FBQUEsUUFDUixnQkFBZ0I7QUFBQSxNQUNsQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

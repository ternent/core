// vite.config.ts
import { resolve } from "node:path";
import { defineConfig } from "file:///Users/sam/dev/ternent/core/node_modules/.pnpm/vite@2.9.18/node_modules/vite/dist/node/index.js";
var __vite_injected_original_dirname = "/Users/sam/dev/ternent/core/packages/workspace";
var vite_config_default = defineConfig({
  build: {
    target: "es2022",
    lib: {
      entry: resolve(__vite_injected_original_dirname, "src/index.ts"),
      name: "ternentWorkspace",
      fileName: "index"
    },
    rollupOptions: {
      external: [
        "@ternent/armour",
        "@ternent/concord",
        "@ternent/identity",
        "@ternent/ledger"
      ]
    }
  },
  test: {
    environment: "node"
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvd29ya3NwYWNlXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvVXNlcnMvc2FtL2Rldi90ZXJuZW50L2NvcmUvcGFja2FnZXMvd29ya3NwYWNlL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9Vc2Vycy9zYW0vZGV2L3Rlcm5lbnQvY29yZS9wYWNrYWdlcy93b3Jrc3BhY2Uvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyByZXNvbHZlIH0gZnJvbSBcIm5vZGU6cGF0aFwiO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSBcInZpdGVcIjtcblxuZXhwb3J0IGRlZmF1bHQgZGVmaW5lQ29uZmlnKHtcbiAgYnVpbGQ6IHtcbiAgICB0YXJnZXQ6IFwiZXMyMDIyXCIsXG4gICAgbGliOiB7XG4gICAgICBlbnRyeTogcmVzb2x2ZShfX2Rpcm5hbWUsIFwic3JjL2luZGV4LnRzXCIpLFxuICAgICAgbmFtZTogXCJ0ZXJuZW50V29ya3NwYWNlXCIsXG4gICAgICBmaWxlTmFtZTogXCJpbmRleFwiLFxuICAgIH0sXG4gICAgcm9sbHVwT3B0aW9uczoge1xuICAgICAgZXh0ZXJuYWw6IFtcbiAgICAgICAgXCJAdGVybmVudC9hcm1vdXJcIixcbiAgICAgICAgXCJAdGVybmVudC9jb25jb3JkXCIsXG4gICAgICAgIFwiQHRlcm5lbnQvaWRlbnRpdHlcIixcbiAgICAgICAgXCJAdGVybmVudC9sZWRnZXJcIixcbiAgICAgIF0sXG4gICAgfSxcbiAgfSxcbiAgdGVzdDoge1xuICAgIGVudmlyb25tZW50OiBcIm5vZGVcIixcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUE0VCxTQUFTLGVBQWU7QUFDcFYsU0FBUyxvQkFBb0I7QUFEN0IsSUFBTSxtQ0FBbUM7QUFHekMsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsT0FBTztBQUFBLElBQ0wsUUFBUTtBQUFBLElBQ1IsS0FBSztBQUFBLE1BQ0gsT0FBTyxRQUFRLGtDQUFXLGNBQWM7QUFBQSxNQUN4QyxNQUFNO0FBQUEsTUFDTixVQUFVO0FBQUEsSUFDWjtBQUFBLElBQ0EsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLFFBQ1I7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLE1BQU07QUFBQSxJQUNKLGFBQWE7QUFBQSxFQUNmO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K

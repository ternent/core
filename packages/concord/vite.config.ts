import { defineLibrary } from "@ternent/tooling/config";
export default defineLibrary({
  entry: {
    index: "src/index.ts",
    "protocol/index": "src/protocol/index.ts",
    "system/index": "src/system/index.ts",
    "testing/index": "src/testing/index.ts",
  },
});

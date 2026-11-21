import { defineCliLibrary } from "@ternent/tooling/config";

export default defineCliLibrary({ entry: { index: "src/index.ts", cli: "src/cli.ts" } });

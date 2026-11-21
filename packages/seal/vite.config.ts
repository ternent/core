import { defineCliLibrary } from "@ternent/tooling/config";
export default defineCliLibrary({
  entry: {
    index: "src/index.ts",
    proof: "src/proof.ts",
    artifact: "src/artifact.ts",
    manifest: "src/manifest.ts",
    crypto: "src/crypto.ts",
    errors: "src/errors.ts",
    cli: "src/cli.ts",
  },
});

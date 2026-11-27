import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { restoreIdentity } from "@ternent/identity";
import { createSealHash, createSealProof, verifySealProof } from "./index.js";

const usage = `Usage: seal sign --input <file> [--out <proof.json>]
       seal verify --proof <proof.json> --input <file>

sign reads the identity backup named by SEAL_IDENTITY_FILE.
Exit codes: 0 success, 1 error, 2 invalid proof.`;

type Io = {
  env: Record<string, string | undefined>;
  stdout: (text: string) => void;
  stderr: (text: string) => void;
};

const processIo: Io = {
  env: process.env,
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export async function runCli(argv: string[], io: Io = processIo): Promise<number> {
  try {
    const { positionals, values } = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        input: { type: "string" },
        out: { type: "string" },
        proof: { type: "string" },
        help: { type: "boolean" },
      },
    });
    const [command] = positionals;

    if (values.help || positionals.length === 0) {
      io.stdout(`${usage}\n`);
      return 0;
    }
    if (command === "sign" && positionals.length === 1 && values.input && !values.proof) {
      const identityFile = io.env.SEAL_IDENTITY_FILE;
      if (!identityFile) throw new Error("Set SEAL_IDENTITY_FILE to an identity backup");
      const signer = await restoreIdentity(await readFile(identityFile, "utf8"));
      const hash = await createSealHash(await readFile(values.input));
      const proof = `${JSON.stringify(await createSealProof({ signer, subject: { hash } }), null, 2)}\n`;
      if (values.out) await writeFile(values.out, proof);
      else io.stdout(proof);
      return 0;
    }
    if (command === "verify" && positionals.length === 1 && values.input && values.proof) {
      const proof: unknown = JSON.parse(await readFile(values.proof, "utf8"));
      const result = await verifySealProof(proof, await readFile(values.input));
      io.stdout(`${JSON.stringify(result)}\n`);
      return result.valid ? 0 : 2;
    }
    throw new Error(usage);
  } catch (error) {
    io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

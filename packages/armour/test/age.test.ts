import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type PrimitiveResult } from "@ternent/identity";
import {
  identityFromSeed,
  encryptAge,
  decryptAgeWithSecret,
  encryptForRecipients,
} from "../src/index.js";
const hex = (value: string) => Uint8Array.from(value.match(/../g)!, (byte) => parseInt(byte, 16));
function value<T>(result: PrimitiveResult<T>): T {
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
}
const vectors = JSON.parse(
  readFileSync(
    new URL("../../../docs/concord/vectors/owner.expected.json", import.meta.url),
    "utf8",
  ),
) as {
  identitySeedHex: string;
  groupSecretHex: string;
  groupRecipient: string;
  groupAgeSecretKey: string;
  keyPlaintext: unknown;
  eventPlaintext: unknown;
};
const document = JSON.parse(
  readFileSync(
    new URL("../../../docs/concord/vectors/owner.document.json", import.meta.url),
    "utf8",
  ),
) as {
  entries: {
    subject: {
      payload: { data: { data?: { wraps: { ciphertext: string }[] }; ciphertext?: string } };
    };
  }[];
};
const decode = (text: string) => new Uint8Array(Buffer.from(text, "base64url"));
test("saved independent native-age ciphertext decrypts with the same owner and group material", async () => {
  const owner = value(await identityFromSeed(hex(vectors.identitySeedHex)));
  const wrapped = document.entries[0].subject.payload.data.data!.wraps[0].ciphertext;
  expect(
    JSON.parse(new TextDecoder().decode(value(await owner.decryptAge(decode(wrapped))))),
  ).toEqual(vectors.keyPlaintext);
  const event = document.entries[1].subject.payload.data.ciphertext!;
  expect(
    JSON.parse(
      new TextDecoder().decode(
        value(
          await decryptAgeWithSecret({
            secret: hex(vectors.groupSecretHex),
            ciphertext: decode(event),
          }),
        ),
      ),
    ),
  ).toEqual(vectors.eventPlaintext);
});
test("binary age needs no initialization; fresh encryption, tampering and wrong identities", async () => {
  const owner = value(await identityFromSeed(hex(vectors.identitySeedHex)));
  const plaintext = new TextEncoder().encode("portable age");
  const a = value(await encryptAge({ recipients: [vectors.groupRecipient], plaintext }));
  const b = value(await encryptAge({ recipients: [vectors.groupRecipient], plaintext }));
  expect(a).not.toEqual(b);
  expect(
    value(await decryptAgeWithSecret({ secret: hex(vectors.groupSecretHex), ciphertext: a })),
  ).toEqual(plaintext);
  expect(await owner.decryptAge(a)).toMatchObject({ ok: false });
  a[a.length - 1] ^= 1;
  expect(
    await decryptAgeWithSecret({ secret: hex(vectors.groupSecretHex), ciphertext: a }),
  ).toMatchObject({ ok: false });
});
test("T04: TypeScript to native age and native age to TypeScript", async () => {
  const temporary = mkdtempSync(join(tmpdir(), "concord-age-"));
  try {
    const key = join(temporary, "key.txt");
    writeFileSync(key, `${vectors.groupAgeSecretKey}\n`, { mode: 0o600 });
    const plaintext = new TextEncoder().encode("independent interop");
    const encrypted = value(await encryptAge({ recipients: [vectors.groupRecipient], plaintext }));
    expect(
      new Uint8Array(execFileSync("age", ["--decrypt", "-i", key], { input: encrypted })),
    ).toEqual(plaintext);
    const native = new Uint8Array(
      execFileSync("age", ["--encrypt", "-r", vectors.groupRecipient], { input: plaintext }),
    );
    expect(
      value(
        await decryptAgeWithSecret({ secret: hex(vectors.groupSecretHex), ciphertext: native }),
      ),
    ).toEqual(plaintext);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("retained recipient helpers preserve their default ASCII armor output", async () => {
  const result = await encryptForRecipients({
    recipients: [vectors.groupRecipient],
    data: new TextEncoder().encode("legacy output"),
  });
  expect(new TextDecoder().decode(result)).toContain("-----BEGIN AGE ENCRYPTED FILE-----");
});

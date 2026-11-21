import { canonicalize as canonicalizeHistory } from "@ternent/ledger/protocol";
import type { Result } from "../common/errors.js";
export { encodeJson, parseJson, unicode, utf8, text } from "@ternent/ledger/protocol";
export function canonicalize(value: unknown): Result<Uint8Array> {
  return canonicalizeHistory(value) as Result<Uint8Array>;
}

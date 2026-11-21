import { encodeBase64Url } from "@ternent/identity";
export function nonce(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(16)));
}

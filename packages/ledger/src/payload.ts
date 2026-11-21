import { decodeBase64Url, encodeBase64Url } from "@ternent/identity";
import { fail } from "./common/errors.js";
import { detached } from "./common/immutable.js";
import { encodeJson, parseJson } from "./protocol/json.js";
import { limits } from "./schema.js";
import type { Json } from "./protocol/types.js";
import type { LedgerLimits } from "./types.js";

/** Structural byte codec supplied by the host; Ledger owns no encryption or keys. */
export type LedgerPayloadCodec = {
  readonly id: string;
  encode?(this: void, plaintext: Uint8Array): Promise<Uint8Array>;
  /** null means unavailable to this reader; exceptions remain operational failures. */
  decode?(this: void, encoded: Uint8Array): Promise<Uint8Array | null>;
};
export type LedgerPayloadEncoder = LedgerPayloadCodec &
  Required<Pick<LedgerPayloadCodec, "encode">>;
export type LedgerPayloadDecoder = LedgerPayloadCodec &
  Required<Pick<LedgerPayloadCodec, "decode">>;
export type LedgerEncodedPayload = {
  format: "ledger-payload";
  version: 1;
  codec: string;
  data: string;
};
export type LedgerDecodedPayload =
  | { status: "plain" | "decoded"; data: Json }
  | { status: "locked"; codec: string };
type PayloadLimits = Partial<Pick<LedgerLimits, "maxBytes" | "maxDepth">>;
const validId = (id: unknown): id is string =>
  typeof id === "string" && /^[a-z][a-z0-9.-]{0,127}$/.test(id);
function codecId(codec: LedgerPayloadCodec): string {
  if (!codec || !validId(codec.id)) fail("HOST_CONFIGURATION", "requirements");
  return codec.id;
}

/** Encode portable JSON before appending it through the ordinary Ledger API. */
export async function encodePayload(
  data: Json,
  codec: LedgerPayloadEncoder,
  options?: PayloadLimits,
): Promise<LedgerEncodedPayload> {
  const lim = limits(options),
    id = codecId(codec),
    encode = codec.encode;
  if (typeof encode !== "function") fail("HOST_CONFIGURATION", "requirements");
  const plaintext = encodeJson(data, lim.maxDepth);
  if (plaintext.byteLength > lim.maxBytes) fail("RESOURCE_LIMIT", "input");
  const encoded = await encode(plaintext);
  if (!(encoded instanceof Uint8Array)) fail("PAYLOAD_CODEC_INVALID", "input");
  if (encoded.byteLength > lim.maxBytes) fail("RESOURCE_LIMIT", "input");
  const payload: LedgerEncodedPayload = {
    format: "ledger-payload",
    version: 1,
    codec: id,
    data: encodeBase64Url(encoded),
  };
  if (encodeJson(payload, lim.maxDepth).byteLength > lim.maxBytes) fail("RESOURCE_LIMIT", "input");
  return detached(payload);
}

/** Decode a replayed payload without changing the signed entry or asserting trust. */
export async function decodePayload(
  payload: Json,
  codec?: LedgerPayloadCodec,
  options?: PayloadLimits,
): Promise<LedgerDecodedPayload> {
  const lim = limits(options);
  const data = parseJson(encodeJson(payload, lim.maxDepth), lim.maxDepth, lim.maxBytes);
  if (!data || typeof data !== "object" || Array.isArray(data) || data.format !== "ledger-payload")
    return detached({ status: "plain", data });
  if (
    Object.keys(data).length !== 4 ||
    data.version !== 1 ||
    !validId(data.codec) ||
    typeof data.data !== "string"
  )
    fail("PAYLOAD_INVALID", "input");
  const encoded = decodeBase64Url(data.data);
  if (!encoded.ok) fail("PAYLOAD_INVALID", "input");
  const locked = () => detached({ status: "locked" as const, codec: data.codec as string });
  if (!codec || codecId(codec) !== data.codec || codec.decode === undefined) return locked();
  const decode = codec.decode;
  if (typeof decode !== "function") fail("HOST_CONFIGURATION", "requirements");
  const plaintext = await decode(encoded.value);
  if (plaintext === null) return locked();
  if (!(plaintext instanceof Uint8Array)) fail("PAYLOAD_CODEC_INVALID", "input");
  return detached({ status: "decoded", data: parseJson(plaintext, lim.maxDepth, lim.maxBytes) });
}

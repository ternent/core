import { attempt, fail, type Result } from "../common/errors.js";
import type { Json } from "./types.js";
export const utf8 = new TextEncoder();
export const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
export function unicode(value: string): boolean {
  for (let i = 0; i < value.length; i++) {
    const c = value.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}
export function encodeJson(input: unknown, maxDepth = 64): Uint8Array {
  const active = new Set<object>();
  function encode(value: unknown, depth: number): string {
    if (value === null) return "null";
    if (typeof value === "string") {
      if (!unicode(value)) fail("JSON_INVALID", "input");
      return JSON.stringify(value);
    }
    if (typeof value === "boolean") return String(value);
    if (typeof value === "number") {
      if (!Number.isSafeInteger(value) || Object.is(value, -0)) fail("JSON_INVALID", "input");
      return String(value);
    }
    if (!value || typeof value !== "object") fail("JSON_INVALID", "input");
    if (depth + 1 > maxDepth) fail("RESOURCE_LIMIT");
    const prototype = Object.getPrototypeOf(value);
    if (
      (Array.isArray(value) && prototype !== Array.prototype) ||
      (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype) ||
      active.has(value)
    )
      fail("JSON_INVALID", "input");
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (
      Object.getOwnPropertySymbols(value).length ||
      Object.values(descriptors).some((d) => !("value" in d))
    )
      fail("JSON_INVALID", "input");
    active.add(value);
    let output: string;
    if (Array.isArray(value)) {
      if (Object.keys(descriptors).length !== value.length + 1) fail("JSON_INVALID", "input");
      const items: string[] = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(descriptors, String(i))) fail("JSON_INVALID", "input");
        items.push(encode(descriptors[i].value, depth + 1));
      }
      output = `[${items.join(",")}]`;
    } else {
      output = `{${Object.keys(descriptors)
        .sort()
        .map((key) => `${encode(key, depth + 1)}:${encode(descriptors[key].value, depth + 1)}`)
        .join(",")}}`;
    }
    active.delete(value);
    return output;
  }
  return utf8.encode(encode(input, 0));
}
export function canonicalize(value: unknown): Result<Uint8Array> {
  return attempt(() => encodeJson(value), "JSON_INVALID", "input");
}
function numberToken(token: string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/.exec(token)!;
  let digits = (match[2] + (match[3] ?? "")).replace(/^0+/, "");
  if (!digits) {
    if (match[1]) fail("JSON_INVALID", "input");
    return 0;
  }
  const scale = Number(match[4] ?? 0) - (match[3]?.length ?? 0);
  if (!Number.isSafeInteger(scale)) fail("JSON_INVALID", "input");
  if (scale < 0) {
    if (-scale > digits.length || !digits.endsWith("0".repeat(-scale)))
      fail("JSON_INVALID", "input");
    digits = digits.slice(0, scale);
  } else {
    if (digits.length + scale > 16) fail("JSON_INVALID", "input");
    digits += "0".repeat(scale);
  }
  if (digits.length > 16 || (digits.length === 16 && digits > "9007199254740991"))
    fail("JSON_INVALID", "input");
  return Number(`${match[1]}${digits}`);
}
export function parseJson(bytes: Uint8Array, maxDepth = 64, maxBytes = 16 * 1024 * 1024): Json {
  if (bytes.length > maxBytes) fail("RESOURCE_LIMIT");
  let source: string;
  try {
    source = text.decode(bytes);
  } catch {
    fail("JSON_INVALID", "input");
  }
  if (source.charCodeAt(0) === 0xfeff) fail("JSON_INVALID", "input");
  let offset = 0;
  function space() {
    while (offset < source.length && " \t\n\r".includes(source[offset])) offset++;
  }
  function string(): string {
    const start = offset++;
    while (offset < source.length) {
      const c = source[offset++];
      if (c === '"') {
        let value: string;
        try {
          value = JSON.parse(source.slice(start, offset));
        } catch {
          fail("JSON_INVALID", "input");
        }
        if (!unicode(value)) fail("JSON_INVALID", "input");
        return value;
      }
      if (c === "\\") offset++;
    }
    return fail("JSON_INVALID", "input");
  }
  function value(depth: number): Json {
    space();
    const c = source[offset];
    if (c === '"') return string();
    if (c === "{" || c === "[") {
      if (depth + 1 > maxDepth) fail("RESOURCE_LIMIT");
      offset++;
      space();
      if (c === "[") {
        const result: Json[] = [];
        if (source[offset] === "]") {
          offset++;
          return result;
        }
        while (true) {
          result.push(value(depth + 1));
          space();
          if (source[offset] === "]") {
            offset++;
            return result;
          }
          if (source[offset++] !== ",") fail("JSON_INVALID", "input");
        }
      }
      const result: Record<string, Json> = Object.create(null);
      const keys = new Set<string>();
      if (source[offset] === "}") {
        offset++;
        return result;
      }
      while (true) {
        space();
        if (source[offset] !== '"') fail("JSON_INVALID", "input");
        const key = string();
        if (keys.has(key)) fail("JSON_INVALID", "input");
        keys.add(key);
        space();
        if (source[offset++] !== ":") fail("JSON_INVALID", "input");
        result[key] = value(depth + 1);
        space();
        if (source[offset] === "}") {
          offset++;
          return result;
        }
        if (source[offset++] !== ",") fail("JSON_INVALID", "input");
      }
    }
    for (const [literal, result] of [
      ["true", true],
      ["false", false],
      ["null", null],
    ] as const)
      if (source.startsWith(literal, offset)) {
        offset += literal.length;
        return result;
      }
    const number = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/.exec(source.slice(offset));
    if (number) {
      offset += number[0].length;
      return numberToken(number[0]);
    }
    return fail("JSON_INVALID", "input");
  }
  const result = value(0);
  space();
  if (offset !== source.length) fail("JSON_INVALID", "input");
  return result;
}

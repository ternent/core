// Seal's canonical JSON domain is independent of Concord's protocol.
export function canonicalStringify(input: unknown): string {
  const seen = new Set<object>();
  function string(value: string): string {
    for (let i = 0; i < value.length; i++) {
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i);
        if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError("Invalid Unicode string");
      } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError("Invalid Unicode string");
    }
    return value;
  }
  function visit(value: unknown, depth: number): unknown {
    if (value === null || typeof value === "boolean") return value;
    if (typeof value === "string") return string(value);
    if (typeof value === "number" && Number.isSafeInteger(value) && !Object.is(value, -0))
      return value;
    if (!value || typeof value !== "object")
      throw new TypeError("Unsupported canonical JSON value");
    if (depth >= 64 || seen.has(value)) throw new TypeError("Canonical JSON depth or cycle");
    const proto: unknown = Object.getPrototypeOf(value);
    if (
      Array.isArray(value)
        ? proto !== Array.prototype
        : proto !== Object.prototype && proto !== null
    )
      throw new TypeError("Canonical JSON requires plain objects");
    seen.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (keys.some((key) => typeof key !== "string")) throw new TypeError("JSON symbol key");
      const get = (key: string) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor || !Object.hasOwn(descriptor, "value") || !descriptor.enumerable)
          throw new TypeError("Canonical JSON requires enumerable data properties");
        return visit(descriptor.value, depth + 1);
      };
      if (Array.isArray(value)) {
        if (keys.length !== value.length + 1) throw new TypeError("Invalid JSON array");
        return Array.from({ length: value.length }, (_, i) => get(String(i)));
      }
      const result = Object.create(null) as Record<string, unknown>;
      for (const key of (keys as string[]).sort()) result[string(key)] = get(key);
      return result;
    } finally {
      seen.delete(value);
    }
  }
  // Native integer-index enumeration is retained from the previous Seal codec.
  return JSON.stringify(visit(input, 0));
}
export function copyJson<T>(input: T): T {
  return JSON.parse(canonicalStringify(input)) as T;
}
export async function hashBytes(input: Uint8Array | ArrayBuffer): Promise<string> {
  if (!(input instanceof Uint8Array) && !(input instanceof ArrayBuffer))
    throw new TypeError("Expected bytes");
  const bytes =
    input instanceof Uint8Array ? new Uint8Array(input) : new Uint8Array(input.slice(0));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

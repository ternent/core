import { expect, test } from "vite-plus/test";
import { greet } from "../src/index.js";
import { formatCount } from "../src/format.js";
test("public behavior includes the validation failure", () => {
  expect(greet("Concord")).toBe("Hello, Concord");
  expect(formatCount(2)).toBe("2 items");
  expect(() => formatCount(-1)).toThrow(RangeError);
});

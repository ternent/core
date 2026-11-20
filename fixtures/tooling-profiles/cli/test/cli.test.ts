import { expect, test } from "vite-plus/test";
import { renderGreeting } from "../src/index.js";
test("library import has the CLI behavior without executing it", () => {
  expect(renderGreeting("CLI")).toBe("Hello, CLI");
});

import { expect, test } from "vite-plus/test";
import { greet } from "@ternent-fixtures/library";
test("the app resolves the built sibling public export", () => {
  expect(greet("Concord")).toBe("Hello, Concord");
});

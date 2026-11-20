import { expect, test } from "vite-plus/test";
import { greet } from "@ternent-fixtures/library";
test("the documented library example resolves its public import", () => {
  expect(greet("docs")).toBe("Hello, docs");
});

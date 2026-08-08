import { describe, expect, it } from "vitest";
import * as workspace from "../src";

describe("@ternent/workspace public api", () => {
  it("exports the framework-agnostic runtime from the package root", () => {
    expect(typeof workspace.createRuntimeCore).toBe("function");
    expect(typeof workspace.createConcordLocalStorageAdapter).toBe("function");
    expect("createAppApi" in workspace).toBe(false);
  });

  it("exports plugin authoring helpers from the package root", () => {
    expect(typeof workspace.createUsersPlugin).toBe("function");
    expect(typeof workspace.createPermissionsPlugin).toBe("function");
    expect(typeof workspace.createRuntimePrivacyService).toBe("function");
  });
});

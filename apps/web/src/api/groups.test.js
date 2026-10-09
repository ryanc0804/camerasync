import { describe, expect, it } from "vitest";

import { getPrimaryGroupId } from "./groups.js";

const groups = [
  { id: "dance", joinedAt: "2026-09-02T00:00:00Z" },
  { id: "cheer", joinedAt: "2026-09-01T00:00:00Z" },
  { id: "vb", joinedAt: "2026-09-03T00:00:00Z" },
];

describe("getPrimaryGroupId", () => {
  it("uses the primary group saved on the account", () => {
    expect(getPrimaryGroupId({ primaryGroupId: "vb" }, groups)).toBe("vb");
  });

  it("falls back to the first joined group when none is saved", () => {
    expect(getPrimaryGroupId({ primaryGroupId: null }, groups)).toBe("cheer");
  });

  it("falls back when the saved group is one the user has left", () => {
    expect(getPrimaryGroupId({ primaryGroupId: "gone" }, groups)).toBe("cheer");
  });

  it("is empty with no groups", () => {
    expect(getPrimaryGroupId({ primaryGroupId: "vb" }, [])).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { speedFor } from "./angleSync.js";

describe("speedFor", () => {
  it("leaves an angle within half a frame alone", () => {
    expect(speedFor(0)).toBe(1);
    expect(speedFor(15)).toBe(1);
    expect(speedFor(-15)).toBe(1);
  });

  it("slows an angle that is ahead and speeds up one that is behind", () => {
    expect(speedFor(30)).toBeCloseTo(1 - 0.0198, 9);
    expect(speedFor(-30)).toBeGreaterThan(1);
  });

  it("never changes speed by more than 5%", () => {
    expect(speedFor(390)).toBe(0.95);
    expect(speedFor(-390)).toBe(1.05);
  });
});

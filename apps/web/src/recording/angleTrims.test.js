import { describe, expect, it } from "vitest";

import { angleTrims } from "./angleTrims.js";

describe("angleTrims", () => {
  it("skips earlier angles ahead to the last camera's start", () => {
    // The laptop began on time, the phone 870 ms late: the laptop skips
    // 0.87 s so both show the same moment.
    const trims = angleTrims([
      { userId: 1, url: "/a.webm", startOffsetMs: 0 },
      { userId: 2, url: "/b.mp4", startOffsetMs: 870 },
    ]);
    expect(trims.get(1)).toBeCloseTo(0.87);
    expect(trims.get(2)).toBe(0);
  });

  it("counts angles that didn't report as on time", () => {
    const trims = angleTrims([
      { userId: 1, url: "/a.webm", startOffsetMs: null },
      { userId: 2, url: "/b.mp4", startOffsetMs: 300 },
      { userId: 3, url: "/c.mp4", startOffsetMs: -100 },
    ]);
    expect(trims.get(1)).toBeCloseTo(0.3);
    expect(trims.get(2)).toBe(0);
    expect(trims.get(3)).toBeCloseTo(0.4);
  });

  it("ignores angles that weren't uploaded", () => {
    const trims = angleTrims([
      { userId: 1, url: "/a.webm", startOffsetMs: 200 },
      { userId: 2, url: null, startOffsetMs: 5000 },
    ]);
    expect(trims.get(1)).toBe(0);
    expect(trims.has(2)).toBe(false);
  });
});

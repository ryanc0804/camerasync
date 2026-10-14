import { describe, expect, it } from "vitest";

import { anglesPerPage, bestGrid, commonAspect, layoutAngles } from "./angleLayout.js";

const H = 16 / 9;
const V = 9 / 16;
const inside = (rect, width, height) =>
  rect.left >= -0.01 && rect.top >= -0.01 &&
  rect.left + rect.width <= width + 0.01 && rect.top + rect.height <= height + 0.01;
const overlaps = (a, b) =>
  a.left < b.left + b.width - 0.01 && b.left < a.left + a.width - 0.01 &&
  a.top < b.top + b.height - 0.01 && b.top < a.top + a.height - 0.01;

describe("bestGrid", () => {
  it("puts two horizontal angles side by side on a laptop, not stacked", () => {
    expect(bestGrid(1200, 640, 2, H).columns).toBe(2);
  });

  it("makes four horizontal angles a 2 x 2", () => {
    const g = bestGrid(1200, 640, 4, H);
    expect([g.columns, g.rows]).toEqual([2, 2]);
  });

  it("lines vertical angles up in one row on a laptop", () => {
    expect(bestGrid(1200, 640, 4, V).columns).toBe(4);
  });

  it("stacks horizontal angles on an upright phone", () => {
    expect(bestGrid(360, 600, 2, H).columns).toBe(1);
  });
});

describe("anglesPerPage", () => {
  it("fits a 3 x 3 of horizontal angles on a laptop", () => {
    expect(anglesPerPage(963, 460, H)).toBe(9);
  });

  it("fits more on a big monitor", () => {
    expect(anglesPerPage(1500, 820, H)).toBeGreaterThanOrEqual(16);
  });

  it("always shows at least one", () => {
    expect(anglesPerPage(200, 100, H)).toBe(1);
  });
});

describe("commonAspect", () => {
  it("goes with the usual shape, and 16:9 before anything loads", () => {
    expect(commonAspect([])).toBeCloseTo(H);
    expect(commonAspect([H, H, V])).toBeCloseTo(H);
    expect(commonAspect([V, V, H])).toBeCloseTo(V);
  });
});

describe("layoutAngles", () => {
  for (const mode of ["grid", "spotlight"]) {
    for (const [width, height] of [[1200, 640], [360, 600], [780, 330]]) {
      for (const aspect of [H, V]) {
        it(`${mode} keeps 1-6 tiles on a ${width}x${height} screen without overlap (${aspect > 1 ? "horizontal" : "vertical"})`, () => {
          for (let count = 1; count <= 6; count += 1) {
            const rects = layoutAngles({ width, height, count, aspect, mode, featured: count - 1 });
            expect(rects).toHaveLength(count);
            for (const rect of rects) {
              expect(rect.width).toBeGreaterThan(0);
              expect(inside(rect, width, height)).toBe(true);
              // Each tile has the video's shape: no black bars.
              expect(rect.width / rect.height).toBeCloseTo(aspect, 3);
            }
            for (let a = 0; a < count; a += 1) {
              for (let b = a + 1; b < count; b += 1) {
                expect(overlaps(rects[a], rects[b])).toBe(false);
              }
            }
          }
        });
      }
    }
  }

  it("makes the featured angle the big one in spotlight", () => {
    const rects = layoutAngles({ width: 1200, height: 640, count: 4, aspect: H, mode: "spotlight", featured: 2 });
    const biggest = rects.reduce((max, r, i) => (r.width > rects[max].width ? i : max), 0);
    expect(biggest).toBe(2);
    // The rest sit to the right of it on a wide screen.
    for (const [i, r] of rects.entries()) {
      if (i !== 2) expect(r.left).toBeGreaterThan(rects[2].left + rects[2].width - 1);
    }
  });

  it("puts the small angles underneath on a tall screen", () => {
    const rects = layoutAngles({ width: 360, height: 640, count: 3, aspect: H, mode: "spotlight" });
    expect(rects[1].top).toBeGreaterThan(rects[0].top + rects[0].height - 1);
  });
});

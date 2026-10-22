// Smaller copies of uploads for the multi-angle grid.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/pool.js", () => ({ pool: { query: vi.fn() } }));

const { PREVIEW_SIZE, isSmallEnough, previewArgs } = await import("../src/recordings/previews.js");
const { storedFileIds } = await import("../src/routes/file.js");

describe("previewArgs", () => {
  const filters = (args) => args[args.indexOf("-vf") + 1];

  it("brings a 60 fps video down to 30, keeping its timeline", () => {
    const args = previewArgs("in.mp4", "out.mp4", { fps: 59.94 });
    expect(filters(args)).toMatch(/^fps=30,/);
    expect(args.at(-1)).toBe("out.mp4");
  });

  it("leaves a 30 fps video's frame rate alone", () => {
    expect(filters(previewArgs("in.mp4", "out.mp4", { fps: 30 }))).not.toMatch(/fps=/);
  });

  it("scales the shorter side down to the preview size, never up", () => {
    const scale = filters(previewArgs("in.mp4", "out.mp4", { fps: 30 }));
    expect(scale).toContain(`min(${PREVIEW_SIZE},ih)`);
    expect(scale).toContain(`min(${PREVIEW_SIZE},iw)`);
  });

  it("keeps the sound, for the angle picked to be heard", () => {
    expect(previewArgs("in.mp4", "out.mp4", { fps: 30 })).toContain("0:a:0?");
  });
});

describe("isSmallEnough", () => {
  it("reuses a small, light original as its own preview", () => {
    expect(isSmallEnough({ width: 1280, height: 720, bitRate: 2_500_000, fps: 30 })).toBe(true);
  });

  it("makes a preview of a phone's full-HD video", () => {
    expect(isSmallEnough({ width: 1920, height: 1080, bitRate: 16_000_000, fps: 30 })).toBe(false);
    expect(isSmallEnough({ width: 1080, height: 1920, bitRate: 16_000_000, fps: 30 })).toBe(false);
  });

  it("makes one of a small video with a heavy bitrate", () => {
    expect(isSmallEnough({ width: 1280, height: 720, bitRate: 12_000_000, fps: 30 })).toBe(false);
  });

  it("makes a 30 fps one of a small 60 fps video: half the frames to decode", () => {
    expect(isSmallEnough({ width: 1280, height: 720, bitRate: 2_500_000, fps: 60 })).toBe(false);
  });
});

describe("storedFileIds", () => {
  it("lists each original and preview once, for deleting", () => {
    expect(storedFileIds([
      { file_id: "a.mp4", preview_file_id: "p.mp4" },
      { file_id: "b.mp4", preview_file_id: "b.mp4" },
      { file_id: "c.webm", preview_file_id: null },
      { file_id: null, preview_file_id: null },
    ])).toEqual(["a.mp4", "p.mp4", "b.mp4", "c.webm"]);
  });
});

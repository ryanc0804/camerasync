import { describe, expect, it } from "vitest";

import { notificationLink, timeAgo } from "./notifications.js";

describe("timeAgo", () => {
  const now = new Date("2026-10-09T20:00:00Z");
  const ago = (seconds) => new Date(now - seconds * 1000).toISOString();

  it("counts up from just now to days, then shows the date", () => {
    expect(timeAgo(ago(20), now)).toBe("just now");
    expect(timeAgo(ago(5 * 60), now)).toBe("5m");
    expect(timeAgo(ago(3 * 3600), now)).toBe("3h");
    expect(timeAgo(ago(2 * 86400), now)).toBe("2d");
    expect(timeAgo(ago(10 * 86400), now)).not.toMatch(/d$/);
  });
});

describe("notificationLink", () => {
  const group = { id: "ucf cheer", name: "UCF Cheer" };

  it("opens the recording for a comment, the group for a join", () => {
    expect(notificationLink({ type: "comment", group, session: { id: "abc123" } })).toBe(
      "/watch/abc123"
    );
    expect(notificationLink({ type: "join", group })).toBe("/groups/ucf%20cheer");
  });

  it("sends a live practice to Record so it can be joined, a finished one to its recording", () => {
    const session = (status) => ({ type: "session", group, session: { id: "abc123", status } });
    expect(notificationLink(session("active"))).toBe("/record");
    expect(notificationLink(session("complete"))).toBe("/watch/abc123");
  });
});

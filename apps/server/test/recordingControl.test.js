// Who may start and stop a take for everyone in a live session.
import { describe, expect, it, vi } from "vitest";

vi.mock("../src/db/pool.js", () => ({ pool: { query: vi.fn() } }));

const { canControlRecording, roomMembersFrom } = await import("../src/sockets/websocket.js");

describe("canControlRecording", () => {
  const session = { created_by: 1, owner_id: 2 };

  it("lets the session's creator, the group's owner and its admins control takes", () => {
    expect(canControlRecording({ ...session, role: "member" }, 1)).toBe(true);
    expect(canControlRecording({ ...session, role: "admin" }, 2)).toBe(true);
    expect(canControlRecording({ ...session, role: "admin" }, 3)).toBe(true);
  });

  it("leaves other members and viewers following the host", () => {
    expect(canControlRecording({ ...session, role: "member" }, 3)).toBe(false);
    expect(canControlRecording({ ...session, role: "viewer" }, 3)).toBe(false);
  });

  it("compares ids whether they arrive as numbers or strings", () => {
    expect(canControlRecording({ created_by: "1", owner_id: "2", role: "member" }, 1)).toBe(true);
  });
});

describe("roomMembersFrom", () => {
  const socket = (id, camera) => ({ data: { user: { id, name: `User ${id}` }, camera } });

  it("marks controllers apart from cameras", () => {
    const members = roomMembersFrom([socket(1, false), socket(2, true), socket(3, undefined)]);
    expect(members.map((m) => [m.id, m.camera])).toEqual([[1, false], [2, true], [3, true]]);
  });

  it("lists someone once, as recording if any of their devices is", () => {
    const members = roomMembersFrom([socket(1, false), socket(1, true), { data: {} }]);
    expect(members).toEqual([{ id: 1, name: "User 1", camera: true }]);
  });
});

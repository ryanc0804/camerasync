// Live sessions left on with nobody in them are ended automatically.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/db/pool.js", () => ({ pool: { query: vi.fn() } }));
vi.mock("../src/sockets/websocket.js", () => ({
  closeSessionSocket: vi.fn(),
  sessionInUse: vi.fn(),
}));

const { pool } = await import("../src/db/pool.js");
const { endIdleSessions, IDLE_END_AFTER_MS } = await import("../src/sessions/idleSessions.js");

describe("endIdleSessions", () => {
  beforeEach(() => {
    pool.query.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  it("ends idle live sessions nobody is in, and leaves ones still in use", async () => {
    pool.query.mockImplementation(async (sql) =>
      sql.startsWith("SELECT")
        ? { rows: [{ id: "idle01" }, { id: "busy02" }] }
        : { rowCount: 1 }
    );
    const close = vi.fn();
    const inUse = vi.fn(async (id) => id === "busy02");

    const ended = await endIdleSessions({ inUse, close });

    expect(ended).toEqual(["idle01"]);
    expect(close).toHaveBeenCalledWith("idle01");
    expect(close).not.toHaveBeenCalledWith("busy02");
    // Only live sessions idle for the limit are looked at.
    const [select, params] = pool.query.mock.calls[0];
    expect(select).toMatch(/status = 'active'/);
    expect(params).toEqual([IDLE_END_AFTER_MS / 1000]);
  });

  it("doesn't close a session someone ended in the meantime", async () => {
    pool.query.mockImplementation(async (sql) =>
      sql.startsWith("SELECT") ? { rows: [{ id: "gone03" }] } : { rowCount: 0 }
    );
    const close = vi.fn();

    expect(await endIdleSessions({ inUse: async () => false, close })).toEqual([]);
    expect(close).not.toHaveBeenCalled();
  });
});

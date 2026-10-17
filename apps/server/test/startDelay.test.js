// The wait between pressing Start and the shared start time.
import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import {
  CAMERA_START_MS,
  MAX_START_DELAY_MS,
  MIN_START_DELAY_MS,
  startDelayMs,
  trackRoundTrips,
} from "../src/sockets/startDelay.js";

describe("startDelayMs", () => {
  it("waits the minimum when every connection is quick", () => {
    expect(startDelayMs([40, 120, 300])).toBe(MIN_START_DELAY_MS);
  });

  it("waits the minimum before any round trip is known", () => {
    expect(startDelayMs([])).toBe(MIN_START_DELAY_MS);
    expect(startDelayMs([undefined, null, NaN])).toBe(MIN_START_DELAY_MS);
  });

  it("waits longer for a slow device, with time for its camera", () => {
    expect(startDelayMs([60, 1400, undefined])).toBe(1400 + CAMERA_START_MS);
  });

  it("never waits longer than the maximum", () => {
    expect(startDelayMs([20000])).toBe(MAX_START_DELAY_MS);
  });
});

describe("trackRoundTrips", () => {
  function fakeSocket() {
    return { conn: new EventEmitter(), data: {} };
  }

  it("times each heartbeat and keeps the slowest of the recent ones", () => {
    const socket = fakeSocket();
    let clock = 0;
    trackRoundTrips(socket, () => clock);
    const heartbeat = (ms) => {
      socket.conn.emit("packetCreate", { type: "ping" });
      clock += ms;
      socket.conn.emit("heartbeat");
    };

    heartbeat(80);
    expect(socket.data.roundTripMs).toBe(80);
    heartbeat(900);
    heartbeat(100);
    expect(socket.data.roundTripMs).toBe(900);
    // The 900 ms one drops out after three newer heartbeats.
    heartbeat(120);
    heartbeat(90);
    expect(socket.data.roundTripMs).toBe(120);
  });

  it("ignores other packets and heartbeats without a timed ping", () => {
    const socket = fakeSocket();
    trackRoundTrips(socket, () => 0);
    socket.conn.emit("packetCreate", { type: "message" });
    socket.conn.emit("heartbeat");
    expect(socket.data.roundTripMs).toBeUndefined();
  });
});

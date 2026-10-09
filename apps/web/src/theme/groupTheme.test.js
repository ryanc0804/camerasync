import { describe, expect, it } from "vitest";

import { TEAM_COLORS, teamColor } from "./teamColors.js";
import {
  DEFAULT_THEME,
  applyTheme,
  contrast,
  groupAccent,
  groupTile,
  inkFor,
  legibleOnDark,
  themeFor,
} from "./groupTheme.js";

describe("themeFor", () => {
  it("falls back to 8kount branding with no group", () => {
    expect(themeFor(null)).toEqual(DEFAULT_THEME);
    expect(themeFor(undefined)).toEqual(DEFAULT_THEME);
  });

  it("falls back to 8kount branding when the group's color is unusable", () => {
    expect(themeFor({ primaryColor: "red" })).toEqual(DEFAULT_THEME);
    expect(themeFor({ primaryColor: "#fff" })).toEqual(DEFAULT_THEME);
  });

  it("uses a readable color exactly as chosen", () => {
    const theme = themeFor({ primaryColor: "#ffc72c" });
    expect(theme["--brand"]).toBe("#ffc72c");
    expect(theme["--accent"]).toBe("#ffc72c");
  });

  it("keeps a dark team color on the sidebar but lightens the accent", () => {
    const navy = "#002d72";
    const theme = themeFor({ primaryColor: navy });
    expect(theme["--brand"]).toBe(navy);
    expect(theme["--brand-ink"]).toBe("#ffffff");
    expect(theme["--accent"]).not.toBe(navy);
    expect(contrast(theme["--accent"], "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("puts black text on the sidebar for a light team color", () => {
    expect(themeFor({ primaryColor: "#ffc72c" })["--brand-ink"]).toBe("#000000");
  });
});

describe("legibleOnDark", () => {
  it("leaves already-readable colors alone", () => {
    expect(legibleOnDark("#ffc72c")).toBe("#ffc72c");
  });

  it("makes every color readable on black, even pure black", () => {
    for (const color of ["#000000", "#002d72", "#5b1f1f", "#0d0d0d", "#333333"]) {
      expect(contrast(legibleOnDark(color), "#000000")).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("groupTile", () => {
  it("fills the tile with the team color and picks readable text", () => {
    expect(groupTile({ primaryColor: "#ffc72c" })).toEqual({
      fill: "#ffc72c", ink: "#000000", dark: false,
    });
    expect(groupTile({ primaryColor: "#1e3a8a" })).toEqual({
      fill: "#1e3a8a", ink: "#ffffff", dark: true,
    });
  });

  it("leaves groups without a usable color on the default tile", () => {
    expect(groupTile(null)).toBeNull();
    expect(groupTile({ primaryColor: "gold" })).toBeNull();
  });
});

describe("team palette", () => {
  it("keeps black or white text readable on every color", () => {
    for (const { hex } of TEAM_COLORS) {
      expect(contrast(hex, inkFor(hex))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("matches palette colors in any case and rejects others", () => {
    expect(teamColor("#1E3A8A")).toBe("#1e3a8a");
    expect(teamColor("#000000")).toBe("");
    expect(teamColor(undefined)).toBe("");
  });
});

describe("helpers", () => {
  it("picks the more readable ink", () => {
    expect(inkFor("#ffffff")).toBe("#000000");
    expect(inkFor("#000000")).toBe("#ffffff");
  });

  it("groupAccent matches the theme accent and falls back to gold", () => {
    const group = { primaryColor: "#002d72" };
    expect(groupAccent(group)).toBe(themeFor(group)["--accent"]);
    expect(groupAccent(null)).toBe(DEFAULT_THEME["--accent"]);
  });

  it("applyTheme writes the variables onto the root element", () => {
    const set = {};
    applyTheme({ "--accent": "#123456" }, {
      style: { setProperty: (name, value) => { set[name] = value; } },
    });
    expect(set).toEqual({ "--accent": "#123456" });
  });
});

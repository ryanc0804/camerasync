import { describe, expect, it } from "vitest";

import {
  DEFAULT_THEME,
  applyTheme,
  contrast,
  groupAccent,
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
    const theme = themeFor({ primaryColor: "#ffc72c", secondaryColor: "#0d0d0d" });
    expect(theme["--brand"]).toBe("#ffc72c");
    expect(theme["--accent"]).toBe("#ffc72c");
    expect(theme["--brand-edge"]).toBe("#0d0d0d");
  });

  it("keeps a dark team color on the sidebar but lightens the accent", () => {
    const navy = "#002d72";
    const theme = themeFor({ primaryColor: navy, secondaryColor: "#ffffff" });
    expect(theme["--brand"]).toBe(navy);
    expect(theme["--brand-ink"]).toBe("#ffffff");
    expect(theme["--accent"]).not.toBe(navy);
    expect(contrast(theme["--accent"], "#000000")).toBeGreaterThanOrEqual(4.5);
  });

  it("puts black text on the sidebar for a light team color", () => {
    expect(themeFor({ primaryColor: "#ffc72c" })["--brand-ink"]).toBe("#000000");
  });

  it("drops an invalid secondary color instead of using it", () => {
    const theme = themeFor({ primaryColor: "#e53935", secondaryColor: "nope" });
    expect(theme["--brand-edge"]).toBe("transparent");
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

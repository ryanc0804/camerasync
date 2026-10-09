// Group color theming (SCRUM-71): turns a group's team color into the CSS
// variables the signed-in app is styled with.
//
//   --brand / --brand-ink       sidebar fill and the text on it
//   --brand-active              the sidebar's selected-item tile
//   --accent / --accent-ink     buttons, links and highlights on the black
//                               page, and the text on an accent fill
//   --accent-hover              hover state for accent fills
//
// The sidebar shows the team color exactly as chosen, but --accent is
// lightened until it is readable on the black page: a navy primary makes a
// good sidebar and an unreadable link.

const PAGE_BACKGROUND = "#000000";
// WCAG AA for normal text — accents are used for links and timestamps too.
const MIN_ACCENT_CONTRAST = 4.5;

/// 8kount branding, used when no group is selected.
export const DEFAULT_THEME = {
  "--brand": "#f2cb05",
  "--brand-ink": "#000000",
  "--brand-active": "#ffe870",
  "--accent": "#ffc72c",
  "--accent-ink": "#0d0d0d",
  "--accent-hover": "#ffd75e",
};

const HEX = /^#([0-9a-f]{6})$/i;

function rgb(hex) {
  const match = HEX.exec(hex ?? "");
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]) {
  return `#${[r, g, b]
    .map((v) => Math.round(v).toString(16).padStart(2, "0"))
    .join("")}`;
}

function luminance(color) {
  const [r, g, b] = rgb(color).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/// Black or white, whichever reads better on `color`.
export function inkFor(color) {
  return contrast(color, "#000000") >= contrast(color, "#ffffff")
    ? "#000000"
    : "#ffffff";
}

/// Blend `color` toward white by `amount` (0–1).
export function lighten(color, amount) {
  return hex(rgb(color).map((v) => v + (255 - v) * amount));
}

/// `color` lightened just enough to be readable on the black page.
export function legibleOnDark(color) {
  let candidate = color;
  for (let step = 1; contrast(candidate, PAGE_BACKGROUND) < MIN_ACCENT_CONTRAST; step++) {
    candidate = lighten(color, step / 10);
  }
  return candidate;
}

/// A group's accent as a hex string (for places that build colors from it,
/// like the calendar's tinted chips); 8kount gold when it has no valid color.
export function groupAccent(group) {
  return rgb(group?.primaryColor)
    ? legibleOnDark(group.primaryColor)
    : DEFAULT_THEME["--accent"];
}

/// The CSS variables for a group, or 8kount branding when there is none or
/// its colors are unusable.
export function themeFor(group) {
  const primary = group?.primaryColor;
  if (!rgb(primary)) return DEFAULT_THEME;

  const accent = legibleOnDark(primary);
  return {
    "--brand": primary,
    "--brand-ink": inkFor(primary),
    "--brand-active": lighten(primary, 0.45),
    "--accent": accent,
    // legibleOnDark guarantees 4.5:1 against black, so black text always
    // reads on an accent fill (and matches the rgba(0,0,0,…) text inside
    // accent cards).
    "--accent-ink": "#000000",
    "--accent-hover": lighten(accent, 0.3),
  };
}

/// Colors for a group's tile on the Groups page: the team color edge to edge
/// with black or white text on it. Null when the group has no usable color.
export function groupTile(group) {
  const fill = group?.primaryColor;
  if (!rgb(fill)) return null;
  const ink = inkFor(fill);
  return { fill, ink, dark: ink === "#ffffff" };
}

/// Write a theme onto the document so every stylesheet's var(...) picks it up.
export function applyTheme(theme, root = document.documentElement) {
  for (const [name, value] of Object.entries(theme)) {
    root.style.setProperty(name, value);
  }
}

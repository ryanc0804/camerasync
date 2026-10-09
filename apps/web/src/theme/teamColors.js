// The colors a group can pick, matching apps/server/src/groups/teamColors.js.
// Each one keeps black or white text readable (at least 4.5:1 contrast with
// one of them), so group tiles and the themed sidebar never end up with
// unreadable labels.
export const TEAM_COLORS = [
  { name: "Gold", hex: "#ead217" },
  { name: "Orange", hex: "#f97316" },
  { name: "Red", hex: "#dc2626" },
  { name: "Maroon", hex: "#7f1d1d" },
  { name: "Pink", hex: "#ec4899" },
  { name: "Purple", hex: "#7c3aed" },
  { name: "Navy", hex: "#1e3a8a" },
  { name: "Blue", hex: "#2563eb" },
  { name: "Sky", hex: "#38bdf8" },
  { name: "Teal", hex: "#14b8a6" },
  { name: "Green", hex: "#16a34a" },
  { name: "Gray", hex: "#6b7280" },
];

export const DEFAULT_TEAM_COLOR = TEAM_COLORS[0].hex;

/// The palette entry for `value` (any letter case), or "" if it isn't one.
export function teamColor(value) {
  const hex = String(value ?? "").toLowerCase();
  return TEAM_COLORS.some((color) => color.hex === hex) ? hex : "";
}

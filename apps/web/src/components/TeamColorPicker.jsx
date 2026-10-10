import { inkFor } from "../theme/groupTheme.js";
import { TEAM_COLORS } from "../theme/teamColors.js";

/// A row of swatches for a group's team color. Only palette colors are
/// offered, so text on a group's tile and sidebar always stays readable.
export function TeamColorPicker({ value, onChange, label = "Team color" }) {
  const selected = String(value ?? "").toLowerCase();
  return (
    <div className="team-color-picker" role="radiogroup" aria-label={label}>
      <style>{css}</style>
      {TEAM_COLORS.map((color) => {
        const checked = selected === color.hex;
        return (
          <button key={color.hex} type="button" role="radio"
            aria-checked={checked} aria-label={color.name} title={color.name}
            className="team-color-swatch"
            style={{ background: color.hex, color: inkFor(color.hex) }}
            onClick={() => onChange(color.hex)}>
            {checked ? "✓" : ""}
          </button>
        );
      })}
    </div>
  );
}

const css = `
  .team-color-picker { display: flex; flex-wrap: wrap; gap: 8px; }
  .team-color-swatch {
    width: 34px; height: 34px; padding: 0;
    border: 2px solid rgba(255,255,255,0.18); border-radius: 50%;
    font: inherit; font-weight: 800; cursor: pointer;
  }
  .team-color-swatch[aria-checked="true"] {
    outline: 3px solid currentColor; outline-offset: -7px;
    border-color: #fff;
  }
`;

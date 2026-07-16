import { useState } from "react";

export function SettingsPage({ theme, onSaveTheme }) {
  const [primaryColor, setPrimaryColor] = useState(theme.primary);
  const [secondaryColor, setSecondaryColor] = useState(theme.secondary);

  const handleSave = () => {
    onSaveTheme({ primary: primaryColor, secondary: secondaryColor });
  };

  return (
    <div className="page-stack">
      <section className="panel settings-card theme-settings-card">
        <div className="settings-card-heading">
          <div>
            <h3>Theme</h3>
            <p>Choose your dashboard colors</p>
          </div>
        </div>

        <div className="color-picker-grid">
          <label className="color-picker">
            <strong>Primary color</strong>
            <input
              type="color"
              value={primaryColor}
              aria-label="Primary color"
              onChange={(event) => setPrimaryColor(event.target.value)}
            />
          </label>
          <label className="color-picker">
            <strong>Secondary color</strong>
            <input
              type="color"
              value={secondaryColor}
              aria-label="Secondary color"
              onChange={(event) => setSecondaryColor(event.target.value)}
            />
          </label>
        </div>

        <div className="theme-save-row">
          <button className="button button-primary" type="button" onClick={handleSave}>
            Save Changes
          </button>
        </div>
      </section>
    </div>
  );
}

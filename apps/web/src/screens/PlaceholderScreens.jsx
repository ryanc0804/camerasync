import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import {
  createGroup,
  getGroups,
  joinGroup,
  searchGroups,
} from "../api/groups.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { GearIcon } from "../components/Sidebar.jsx";
import { TeamColorPicker } from "../components/TeamColorPicker.jsx";
import { useGroupTheme } from "../theme/GroupThemeContext.jsx";
import { groupTile } from "../theme/groupTheme.js";
import { DEFAULT_TEAM_COLOR } from "../theme/teamColors.js";

// Shells for the sections that don't have backing APIs yet. Each states what
// it will hold so the nav is honest about what's built vs. planned.

const styles = {
  title: { margin: "0 0 0.5rem", fontSize: "1.8rem" },
  muted: { color: "#999", lineHeight: 1.6, maxWidth: "48ch" },
};

// One group on the Groups list: filled with its team color, with its
// recordings and a gear that opens the group's settings page.
function GroupTile({ group, isPrimary }) {
  const navigate = useNavigate();
  const tile = groupTile(group);

  return (
    <div
      className={`group-row${tile ? ` group-tile ${tile.dark ? "group-tile-dark" : "group-tile-light"}` : ""}`}
      style={tile ? { background: tile.fill, color: tile.ink, borderColor: tile.fill } : undefined}
    >
      <span className="group-tile-name">
        {group.name}
        {isPrimary && <span className="group-tile-badge">Primary</span>}
      </span>
      <button type="button" className="group-button"
        onClick={() => navigate(`/watch?group=${encodeURIComponent(group.id)}`)}>
        Recordings
      </button>
      <button type="button" className="group-button group-gear"
        aria-label={`Settings for ${group.name}`} title="Group settings"
        onClick={() => navigate(`/groups/${encodeURIComponent(group.id)}`)}>
        <GearIcon size={20} />
      </button>
    </div>
  );
}

// A small centered window over a dimmed page for creating or joining a
// group. Closes on Esc, the X, or a click outside it.
function GroupModal({ title, onClose, children }) {
  const dialogRef = useRef(null);

  // Start typing straight away: focus the first field when it opens.
  useEffect(() => {
    dialogRef.current?.querySelector("input:not([type=checkbox]), select, textarea")?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="group-modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div className="group-modal" role="dialog" aria-modal="true" aria-label={title} ref={dialogRef}>
        <div className="group-modal-header">
          <h2>{title}</h2>
          <button type="button" className="group-modal-close" aria-label="Close" onClick={onClose}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2.4"
                strokeLinecap="round" fill="none" />
            </svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function GroupsScreen() {
  const { activeGroup, refresh: refreshTheme } = useGroupTheme();
  const [openPanel, setOpenPanel] = useState(null);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [createSubmitting, setCreateSubmitting] = useState(false);
  const [createError, setCreateError] = useState("");
  const [joinQuery, setJoinQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [passwordGroupId, setPasswordGroupId] = useState(null);
  const [joinPassword, setJoinPassword] = useState("");
  const [joiningGroupId, setJoiningGroupId] = useState(null);
  const [joinError, setJoinError] = useState("");
  const [form, setForm] = useState({
    name: "",
    id: "",
    isPublic: true,
    password: "",
    primaryColor: DEFAULT_TEAM_COLOR,
  });

  useEffect(() => {
    getGroups()
      .then(setGroups)
      .catch((err) => setCreateError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (openPanel !== "join" || !joinQuery) {
      setSearchResults([]);
      setHasSearched(false);
      setSearching(false);
      return;
    }

    let cancelled = false;
    const searchTimer = window.setTimeout(async () => {
      setSearching(true);
      setJoinError("");

      try {
        const results = await searchGroups(joinQuery);
        if (!cancelled) {
          setSearchResults(results);
          setHasSearched(true);
        }
      } catch (err) {
        if (!cancelled) {
          setJoinError(err.message);
          setSearchResults([]);
          setHasSearched(true);
        }
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(searchTimer);
    };
  }, [joinQuery, openPanel]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const closePanel = () => {
    setOpenPanel(null);
    setCreateError("");
    setJoinError("");
    setJoinQuery("");
  };

  const submitGroup = async (event) => {
    event.preventDefault();
    setCreateError("");
    setCreateSubmitting(true);

    try {
      const group = await createGroup(form);
      setGroups((current) => [group, ...current]);
      // A first group becomes the default, which themes the app.
      refreshTheme().catch(() => {});
      setForm({
        name: "",
        id: "",
        isPublic: true,
        password: "",
        primaryColor: DEFAULT_TEAM_COLOR,
      });
      setOpenPanel(null);
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateSubmitting(false);
    }
  };

  const submitJoin = async (group, password = "") => {
    setJoinError("");
    setJoiningGroupId(group.id);

    try {
      const joinedGroup = await joinGroup(group.id, password);
      setGroups((current) => {
        const alreadyListed = current.some(
          (item) => item.id.toLowerCase() === joinedGroup.id.toLowerCase()
        );
        return alreadyListed ? current : [joinedGroup, ...current];
      });
      refreshTheme().catch(() => {});
      setSearchResults((current) =>
        current.map((item) =>
          item.id === group.id ? { ...item, isMember: true } : item
        )
      );
      setPasswordGroupId(null);
      setJoinPassword("");
      closePanel();
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoiningGroupId(null);
    }
  };

  return (
    <div>
      <style>{groupsCss}</style>
      <div className="groups-header">
        <div>
          <h1 style={styles.title}>Groups</h1>
          <p style={styles.muted}>Manage your groups and organizations.</p>
        </div>
        <div className="group-tools">
          <button className="group-tool-button group-tool-primary" type="button"
            onClick={() => setOpenPanel("create")}>
            Create Group
          </button>
          <button className="group-tool-button" type="button"
            onClick={() => setOpenPanel("join")}>
            Join Group
          </button>
        </div>
      </div>

      <div className="groups-grid">
        <section className="group-panel">
          <h2>Your groups</h2>
          {loading ? (
            <p className="group-empty">Loading groups...</p>
          ) : groups.length === 0 ? (
            <EmptyState title="No groups yet">
              Create your team's group, or use Join Group to find it by its ID.
            </EmptyState>
          ) : (
            <div className="group-list">
              {groups.map((group) => (
                <GroupTile
                  key={group.id}
                  group={group}
                  isPrimary={activeGroup?.id === group.id}
                />
              ))}
            </div>
          )}
        </section>

      </div>

      {openPanel === "create" && (
        <GroupModal title="Create a group" onClose={closePanel}>
          <form className="group-tool-content" onSubmit={submitGroup}>
            {createError && (
              <p className="group-error">{createError}</p>
            )}

            <label className="group-field">
              Name
              <input
                type="text"
                value={form.name}
                onChange={(event) =>
                  updateForm("name", event.target.value)
                }
                placeholder="Group name"
                required
              />
            </label>

            <label className="group-field">
              ID
              <input
                type="text"
                pattern="[A-Za-z0-9]+"
                value={form.id}
                placeholder="Letters and numbers only"
                onChange={(event) =>
                  updateForm(
                    "id",
                    event.target.value.replace(/[^a-zA-Z0-9]/g, "")
                  )
                }
                required
              />
            </label>

            <div className="group-privacy-row">
              <label className="group-visibility">
                <input
                  type="checkbox"
                  checked={form.isPublic}
                  onChange={(event) =>
                    updateForm("isPublic", event.target.checked)
                  }
                />
                <span className="group-switch" />
                <span>{form.isPublic ? "Public" : "Private"}</span>
              </label>

              <label className="group-field group-password">
                Password
                <input
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    updateForm("password", event.target.value)
                  }
                  placeholder="Password"
                  readOnly={form.isPublic}
                  required={!form.isPublic}
                />
              </label>
            </div>

            <div className="group-field">
              Team color
              <TeamColorPicker
                value={form.primaryColor}
                onChange={(hex) => updateForm("primaryColor", hex)}
              />
            </div>

            <div className="group-actions">
              <button
                className="group-button"
                type="button"
                onClick={() => setOpenPanel(null)}
              >
                Cancel
              </button>
              <button
                className="group-button group-button-primary"
                type="submit"
                disabled={createSubmitting}
              >
                {createSubmitting ? "Creating..." : "Create Group"}
              </button>
            </div>
          </form>
        </GroupModal>
      )}
      {openPanel === "join" && (
        <GroupModal title="Join a group" onClose={closePanel}>
          <div className="group-tool-content">
            <label className="group-field">
              Group ID
              <input
                type="text"
                value={joinQuery}
                placeholder="Search by group ID"
                onChange={(event) => {
                  setJoinQuery(
                    event.target.value.replace(/[^a-zA-Z0-9]/g, "")
                  );
                  setPasswordGroupId(null);
                  setJoinPassword("");
                }}
              />
            </label>

            {joinError && <p className="group-error">{joinError}</p>}
            {searching ? (
              <p className="group-search-message">Searching...</p>
            ) : hasSearched && searchResults.length === 0 ? (
              <p className="group-search-message">
                Could Not Find Group
              </p>
            ) : (
              <div className="group-search-results">
                {searchResults.map((group) => (
                  <div className="group-search-result" key={group.id}>
                    <div className="group-search-row">
                      <div className="group-search-name">
                        <strong>{group.name}</strong>
                        <span>{group.id}</span>
                      </div>

                      {group.isMember ? (
                        <span className="group-membership">
                          You are already a group member
                        </span>
                      ) : (
                        <button
                          className="group-button group-join-button"
                          type="button"
                          disabled={joiningGroupId === group.id}
                          onClick={() => {
                            if (group.isPublic) {
                              submitJoin(group);
                            } else {
                              setJoinError("");
                              setPasswordGroupId(group.id);
                              setJoinPassword("");
                            }
                          }}
                        >
                          {joiningGroupId === group.id
                            ? "Joining..."
                            : "Join"}
                        </button>
                      )}
                    </div>

                    {!group.isPublic &&
                      !group.isMember &&
                      passwordGroupId === group.id && (
                        <form
                          className="group-join-password"
                          onSubmit={(event) => {
                            event.preventDefault();
                            submitJoin(group, joinPassword);
                          }}
                        >
                          <input
                            type="password"
                            value={joinPassword}
                            placeholder="Password"
                            onChange={(event) =>
                              setJoinPassword(event.target.value)
                            }
                            autoFocus
                            required
                          />
                          <button
                            className="group-button group-button-primary"
                            type="submit"
                            disabled={joiningGroupId === group.id}
                          >
                            {joiningGroupId === group.id
                              ? "Joining..."
                              : "Join"}
                          </button>
                        </form>
                      )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </GroupModal>
      )}
    </div>
  );
}

const groupsCss = `
  .groups-header {
    display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between;
    gap: 16px; max-width: 760px;
  }
  .groups-header p { margin: 0; }
  .groups-grid { max-width: 760px; margin-top: 24px; }
  .group-panel {
    padding: 22px;
    background: #151515;
    border-radius: 14px;
  }
  .group-panel h2 {
    margin: 0 0 18px;
    font-size: 1.15rem;
  }
  .group-tools { display: flex; gap: 10px; }
  .group-tool-button {
    padding: 10px 18px;
    border: none;
    border-radius: 12px;
    background: #1c1c1c;
    color: #f0f0f0;
    font: inherit;
    font-weight: 700;
    cursor: pointer;
  }
  .group-tool-button:hover { background: #262626; }
  .group-tool-primary { background: var(--accent); color: var(--accent-ink); }
  .group-tool-primary:hover { background: var(--accent-hover); }
  .group-modal-backdrop {
    position: fixed; inset: 0; z-index: 50;
    display: flex; align-items: center; justify-content: center;
    padding: 16px; background: rgba(0, 0, 0, 0.65);
  }
  .group-modal {
    box-sizing: border-box; width: min(440px, 100%); max-height: calc(100vh - 32px);
    overflow: auto; padding: 18px 22px 22px; border-radius: 16px;
    background: #1a1a1a; box-shadow: 0 20px 60px rgba(0, 0, 0, 0.6);
  }
  .group-modal-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  .group-modal-header h2 { margin: 0; font-size: 1.2rem; }
  .group-modal-close {
    display: flex; align-items: center; justify-content: center;
    width: 34px; height: 34px; padding: 0; border: none; border-radius: 8px;
    background: transparent; color: #aaa; cursor: pointer;
  }
  .group-modal-close:hover { background: #262626; color: #fff; }
  .group-tool-content {
    margin-top: 10px;
  }
  .group-empty {
    margin: 0;
    padding: 28px 16px;
    border: 1px dashed #3a3a3a;
    border-radius: 8px;
    color: #888;
    text-align: center;
  }
  .group-list {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .group-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 11px 14px;
    border: none;
    border-radius: 12px;
    background: #1c1c1c;
    font-weight: 600;
  }
  .group-tile-name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .group-tile-badge {
    margin-left: 8px; padding: 2px 8px; border-radius: 999px;
    background: rgba(127,127,127,0.25); font-size: 0.7rem; font-weight: 700;
    vertical-align: middle;
  }
  .group-gear { display: flex; align-items: center; justify-content: center; padding: 7px 9px; }
  /* A colored tile keeps its buttons readable on any team color by tinting
     them toward the tile's own text color. */
  .group-tile .group-button { color: inherit; }
  .group-tile-light .group-button { background: rgba(0,0,0,0.12); border-color: rgba(0,0,0,0.3); }
  .group-tile-light .group-button:hover { background: rgba(0,0,0,0.22); }
  .group-tile-dark .group-button { background: rgba(255,255,255,0.14); border-color: rgba(255,255,255,0.35); }
  .group-tile-dark .group-button:hover { background: rgba(255,255,255,0.24); }
  .group-error {
    margin: 0 0 14px;
    padding: 9px 11px;
    border: 1px solid #5a2a2a;
    border-radius: 7px;
    background: #2a1a1a;
    color: #ff8a80;
    font-size: 0.85rem;
  }
  .group-field {
    display: flex;
    flex-direction: column;
    gap: 7px;
    margin-bottom: 15px;
    color: #ddd;
    font-size: 0.85rem;
    font-weight: 600;
  }
  .group-field input[type="text"],
  .group-field input[type="password"],
  .group-join-password input {
    box-sizing: border-box;
    width: 100%;
    padding: 10px 11px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    outline: none;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
  }
  .group-field input:focus {
    border-color: var(--accent);
  }
  .group-field input:disabled {
    border-color: #303030;
    background: #202020;
    color: #666;
    cursor: not-allowed;
    opacity: 0.7;
  }
  .group-privacy-row {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 14px;
    align-items: end;
  }
  .group-visibility {
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 38px;
    margin-bottom: 15px;
    color: #ddd;
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
  }
  .group-visibility input {
    position: absolute;
    opacity: 0;
  }
  .group-switch {
    position: relative;
    width: 36px;
    height: 20px;
    border-radius: 10px;
    background: #555;
  }
  .group-switch::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: #eee;
    transition: left 0.15s;
  }
  .group-visibility input:checked + .group-switch {
    background: var(--accent);
  }
  .group-visibility input:checked + .group-switch::after {
    left: 19px;
    background: var(--accent-ink);
  }
  .group-password {
    min-width: 0;
  }
  .group-search-message {
    margin: 4px 0 0;
    padding: 18px 10px;
    border: 1px dashed #3a3a3a;
    border-radius: 7px;
    color: #888;
    text-align: center;
  }
  .group-search-results {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .group-search-result {
    padding: 11px;
    border: 1px solid #303030;
    border-radius: 8px;
    background: #242424;
  }
  .group-search-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .group-search-name {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 3px;
  }
  .group-search-name strong,
  .group-search-name span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-search-name span {
    color: #999;
    font-size: 0.8rem;
  }
  .group-membership {
    max-width: 145px;
    color: #999;
    font-size: 0.78rem;
    line-height: 1.3;
    text-align: right;
  }
  .group-join-button {
    flex: 0 0 auto;
  }
  .group-join-password {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 9px;
    margin-top: 10px;
  }
  .group-join-password input:focus {
    border-color: var(--accent);
  }
  .group-actions {
    display: flex;
    justify-content: flex-end;
    gap: 10px;
    margin-top: 6px;
  }
  .group-button {
    padding: 9px 14px;
    border: 1px solid #3a3a3a;
    border-radius: 7px;
    background: #262626;
    color: #f0f0f0;
    font: inherit;
    font-weight: 600;
    cursor: pointer;
  }
  .group-button:hover {
    background: #303030;
  }
  .group-button-primary {
    border-color: var(--accent);
    background: var(--accent);
    color: var(--accent-ink);
  }
  .group-button-primary:hover {
    background: var(--accent-hover);
  }
  .group-button:disabled {
    cursor: default;
    opacity: 0.55;
  }
  @media (max-width: 480px) {
    .group-privacy-row {
      grid-template-columns: 1fr;
      gap: 0;
    }
    .group-visibility {
      margin-bottom: 8px;
    }
  }
`;

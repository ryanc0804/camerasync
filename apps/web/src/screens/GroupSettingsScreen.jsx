import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import {
  changeGroupMemberRole,
  getGroupMembers,
  getGroups,
  removeGroupMember,
  setDefaultGroup,
  updateGroupColor,
} from "../api/groups.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { TeamColorPicker } from "../components/TeamColorPicker.jsx";
import { useGroupTheme } from "../theme/GroupThemeContext.jsx";
import { groupTile } from "../theme/groupTheme.js";
import { teamColor } from "../theme/teamColors.js";

const ROSTER_PAGE_SIZE = 30;
const ROLE_LABEL = { admin: "an admin", member: "a member", viewer: "a viewer" };

/// One group's settings page, opened from the gear on its Groups tile:
/// whether it is the user's primary group (whose color the app takes), its
/// team color (admins and the owner), and its roster.
export function GroupSettingsScreen() {
  const { id } = useParams();
  const { user } = useAuth();
  const { activeGroup, selectGroup, refresh: refreshTheme } = useGroupTheme();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [primaryError, setPrimaryError] = useState("");

  useEffect(() => {
    let cancelled = false;
    getGroups()
      .then((groups) => {
        if (!cancelled) {
          setGroup(groups.find((g) => g.id.toLowerCase() === id.toLowerCase()) ?? null);
        }
      })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  if (loading) return <p style={{ color: "#999" }}>Loading group...</p>;
  if (error) return <p role="alert" style={{ color: "#ff8a80" }}>{error}</p>;
  if (!group) {
    return (
      <EmptyState title="Group not found" action="Back to Groups" to="/groups">
        You may have left this group, or the link is wrong.
      </EmptyState>
    );
  }

  const tile = groupTile(group);
  const isOwner = Number(user.id) === group.owner;
  const canManage = isOwner || group.role === "admin";
  const isPrimary = activeGroup?.id === group.id;
  const yourRole = isOwner ? "the owner" : ROLE_LABEL[group.role] ?? "a member";

  const makePrimary = () => {
    try {
      setDefaultGroup(user.id, group.id);
      selectGroup(group.id);
      setPrimaryError("");
    } catch {
      setPrimaryError("Could not save your primary group in this browser.");
    }
  };

  return (
    <div className="gs-page">
      <style>{css}</style>
      <Link to="/groups" className="gs-back">← Groups</Link>

      <header className="gs-banner" style={tile
        ? { background: tile.fill, color: tile.ink }
        : undefined}>
        <div>
          <h1>{group.name}</h1>
          <p>
            ID {group.id} · {group.isPublic ? "Public" : "Private"} · You're {yourRole}
          </p>
        </div>
        <button type="button" className="gs-button gs-on-banner"
          onClick={() => navigate(`/watch?group=${encodeURIComponent(group.id)}`)}>
          Recordings
        </button>
      </header>

      <section className="gs-card">
        <h2>Primary group</h2>
        {isPrimary ? (
          <p>This is your primary group, so the app uses its color.</p>
        ) : (
          <>
            <p>Your primary group sets the app's color.</p>
            <button type="button" className="gs-button gs-button-primary" onClick={makePrimary}>
              Make {group.name} my primary group
            </button>
          </>
        )}
        {primaryError && <p role="alert" className="gs-error">{primaryError}</p>}
      </section>

      {canManage && (
        <TeamColorSection
          group={group}
          onSaved={(updated) => {
            setGroup((current) => ({ ...current, ...updated }));
            refreshTheme().catch(() => {});
          }}
        />
      )}

      <MembersSection group={group} isOwner={isOwner} />
    </div>
  );
}

function TeamColorSection({ group, onSaved }) {
  // A color picked before the palette existed starts unselected.
  const [color, setColor] = useState(teamColor(group.primaryColor));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const changed = color && color !== String(group.primaryColor).toLowerCase();

  const save = async () => {
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      onSaved(await updateGroupColor(group.id, color));
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="gs-card">
      <h2>Team color</h2>
      <p>Shown on the group's tile, and across the app for anyone whose primary group this is.</p>
      <TeamColorPicker value={color} onChange={(hex) => { setColor(hex); setSaved(false); }} />
      {error && <p role="alert" className="gs-error">{error}</p>}
      <div className="gs-actions">
        {saved && !changed && <span className="gs-saved">Saved</span>}
        <button type="button" className="gs-button gs-button-primary"
          disabled={saving || !changed} onClick={save}>
          {saving ? "Saving..." : "Save color"}
        </button>
      </div>
    </section>
  );
}

function MembersSection({ group, isOwner }) {
  const { user } = useAuth();
  const [members, setMembers] = useState([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionError, setActionError] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getGroupMembers(group.id)
      .then((loaded) => { if (!cancelled) setMembers(loaded); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [group.id]);

  const isAdmin = members.find((member) => member.id === Number(user.id))?.role === "admin";

  const updateMember = async (member, role) => {
    const message = role
      ? `Make ${member.name} ${ROLE_LABEL[role]}?`
      : `Remove ${member.name} from this group?`;
    if (!window.confirm(message)) return;
    setSaving(true);
    setActionError("");
    try {
      if (role) {
        await changeGroupMemberRole(group.id, member.id, role);
        setMembers((current) => current.map((item) =>
          item.id === member.id ? { ...item, role } : item
        ));
      } else {
        await removeGroupMember(group.id, member.id);
        const remaining = members.filter((item) => item.id !== member.id);
        setMembers(remaining);
        setPage(Math.min(page, Math.max(0, Math.ceil(remaining.length / ROSTER_PAGE_SIZE) - 1)));
      }
    } catch (err) {
      setActionError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const pageCount = Math.ceil(members.length / ROSTER_PAGE_SIZE);

  return (
    <section className="gs-card">
      <h2>Members{loading ? "" : ` (${members.length})`}</h2>
      {loading ? <p>Loading members...</p> : error ? (
        <p role="alert" className="gs-error">{error}</p>
      ) : (
        <>
          {actionError && <p role="alert" className="gs-error">{actionError}</p>}
          <ul className="gs-members">
            {members.slice(page * ROSTER_PAGE_SIZE, (page + 1) * ROSTER_PAGE_SIZE).map((member) => {
              const canManage = member.id !== group.owner &&
                (isOwner || (isAdmin && ["member", "viewer"].includes(member.role)));
              // One step up / one step down the viewer < member < admin ladder.
              const promoteTo = member.role === "viewer" ? "member" :
                member.role === "member" ? "admin" : null;
              const demoteTo = member.role === "admin" ? "member" :
                member.role === "member" ? "viewer" : null;
              return (
                <li key={member.id}>
                  <span>
                    {member.name}
                    <span className="gs-role">
                      {member.id === group.owner ? "Owner" :
                        member.role === "admin" ? "Admin" :
                        member.role === "viewer" ? "Viewer" : "Member"}
                    </span>
                  </span>
                  {canManage && (
                    <span className="gs-member-actions">
                      {promoteTo && (
                        <button type="button" className="gs-button" disabled={saving}
                          onClick={() => updateMember(member, promoteTo)}
                          aria-label={`Make ${member.name} ${ROLE_LABEL[promoteTo]}`}>↑</button>
                      )}
                      {demoteTo && (
                        <button type="button" className="gs-button" disabled={saving}
                          onClick={() => updateMember(member, demoteTo)}
                          aria-label={`Make ${member.name} ${ROLE_LABEL[demoteTo]}`}>↓</button>
                      )}
                      <button type="button" className="gs-button" disabled={saving}
                        aria-label={`Remove ${member.name} from group`}
                        onClick={() => updateMember(member, null)}>×</button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {pageCount > 1 && (
            <div className="gs-pages">
              <button type="button" className="gs-button" aria-label="Previous members page"
                disabled={page === 0} onClick={() => setPage(page - 1)}>‹</button>
              <span>{page + 1} / {pageCount}</span>
              <button type="button" className="gs-button" aria-label="Next members page"
                disabled={page + 1 >= pageCount} onClick={() => setPage(page + 1)}>›</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const css = `
  .gs-page { max-width: 760px; display: flex; flex-direction: column; gap: 16px; }
  .gs-back { color: var(--accent); align-self: flex-start; }
  .gs-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 22px 24px; border-radius: 12px; background: #242424; color: #f0f0f0;
  }
  .gs-banner h1 { margin: 0 0 6px; font-size: 1.8rem; overflow-wrap: anywhere; }
  .gs-banner p { margin: 0; opacity: 0.8; font-size: 0.9rem; }
  .gs-card {
    padding: 18px 20px; border: 1px solid #2a2a2a; border-radius: 12px; background: #1c1c1c;
  }
  .gs-card h2 { margin: 0 0 8px; font-size: 1.1rem; }
  .gs-card p { margin: 0 0 12px; color: #aaa; font-size: 0.9rem; line-height: 1.5; }
  .gs-button {
    padding: 8px 14px; border: 1px solid #3a3a3a; border-radius: 7px;
    background: #262626; color: #f0f0f0; font: inherit; font-weight: 600; cursor: pointer;
  }
  .gs-button:hover { background: #303030; }
  .gs-button:disabled { opacity: 0.5; cursor: default; }
  .gs-button-primary { border-color: var(--accent); background: var(--accent); color: var(--accent-ink); }
  .gs-button-primary:hover { background: var(--accent-hover); }
  .gs-on-banner { flex: 0 0 auto; border-color: rgba(0,0,0,0.25); background: rgba(0,0,0,0.18); color: inherit; }
  .gs-on-banner:hover { background: rgba(0,0,0,0.3); }
  .gs-actions { display: flex; align-items: center; justify-content: flex-end; gap: 12px; margin-top: 14px; }
  .gs-saved { color: #8bd48b; font-size: 0.85rem; }
  .gs-error { color: #ff8a80 !important; }
  .gs-members { list-style: none; margin: 0; padding: 0; }
  .gs-members li {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 0; border-top: 1px solid #2a2a2a; overflow-wrap: anywhere;
  }
  .gs-members li:first-child { border-top: none; }
  .gs-role { margin-left: 10px; color: #999; font-size: 0.8rem; }
  .gs-member-actions { display: flex; gap: 6px; }
  .gs-member-actions .gs-button { padding: 4px 10px; font-size: 0.8rem; }
  .gs-pages { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; font-size: 0.85rem; }
  @media (max-width: 600px) {
    .gs-banner { flex-direction: column; align-items: flex-start; }
  }
`;

import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import { useAuth } from "../auth/AuthContext.jsx";
import {
  changeGroupMemberRole,
  getGroupMembers,
  getGroups,
  removeGroupMember,
  deleteGroup,
  leaveGroup,
  transferGroup,
  updateGroupColor,
  updateGroupDetails,
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
  const { user, updateProfile } = useAuth();
  const { activeGroup, refresh: refreshTheme } = useGroupTheme();
  const navigate = useNavigate();
  const [group, setGroup] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [primaryError, setPrimaryError] = useState("");
  const [savingPrimary, setSavingPrimary] = useState(false);

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

  const makePrimary = async () => {
    setSavingPrimary(true);
    setPrimaryError("");
    try {
      await updateProfile({ primaryGroupId: group.id });
    } catch (err) {
      setPrimaryError(err.message);
    } finally {
      setSavingPrimary(false);
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
            <button type="button" className="gs-button gs-button-primary"
              disabled={savingPrimary} onClick={makePrimary}>
              {savingPrimary ? "Saving..." : `Make ${group.name} my primary group`}
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

      <InviteSection group={group} />

      <MembersSection group={group} isOwner={isOwner} />

      {isOwner ? (
        <OwnerSection
          group={group}
          onSaved={(updated) => setGroup((current) => ({ ...current, ...updated }))}
          onGone={() => {
            refreshTheme().catch(() => {});
            navigate("/groups");
          }}
        />
      ) : (
        <LeaveSection
          group={group}
          onLeft={() => {
            refreshTheme().catch(() => {});
            navigate("/groups");
          }}
        />
      )}
    </div>
  );
}

/// The owner's controls: the group's name and privacy, handing the group to
/// someone else (after which they can leave), and deleting it.
function OwnerSection({ group, onSaved, onGone }) {
  const { user } = useAuth();
  const [name, setName] = useState(group.name);
  const [isPublic, setIsPublic] = useState(group.isPublic);
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [members, setMembers] = useState([]);
  const [newOwner, setNewOwner] = useState("");
  const [busy, setBusy] = useState(false);
  const [dangerError, setDangerError] = useState("");

  useEffect(() => {
    getGroupMembers(group.id)
      .then((loaded) => setMembers(loaded.filter((m) => m.id !== Number(user.id))))
      .catch(() => {});
  }, [group.id, user.id]);

  const changed = name.trim() !== group.name || isPublic !== group.isPublic || password;

  const saveDetails = async (event) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    try {
      onSaved(await updateGroupDetails(group.id, { name: name.trim(), isPublic, password }));
      setPassword("");
      setSaved(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handOver = async () => {
    const member = members.find((m) => m.id === Number(newOwner));
    if (!member) return;
    if (!window.confirm(`Make ${member.name} the owner of ${group.name}? You'll stay on as an admin.`)) return;
    setBusy(true);
    setDangerError("");
    try {
      onSaved(await transferGroup(group.id, member.id));
      setNewOwner("");
    } catch (err) {
      setDangerError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm(`Delete ${group.name} with all of its sessions, recordings and comments? This can't be undone.`)) return;
    setBusy(true);
    setDangerError("");
    try {
      await deleteGroup(group.id);
      onGone();
    } catch (err) {
      setDangerError(err.message);
      setBusy(false);
    }
  };

  return (
    <>
      <section className="gs-card">
        <h2>Group details</h2>
        <form className="gs-form" onSubmit={saveDetails}>
          <label>
            Name
            <input value={name} maxLength={100} required
              onChange={(event) => { setName(event.target.value); setSaved(false); }} />
          </label>
          <label className="gs-check">
            <input type="checkbox" checked={!isPublic}
              onChange={(event) => { setIsPublic(!event.target.checked); setSaved(false); }} />
            Private: people need a password to join
          </label>
          {!isPublic && (
            <label>
              {group.isPublic ? "Password" : "New password (leave blank to keep the current one)"}
              <input type="password" value={password} required={group.isPublic}
                onChange={(event) => { setPassword(event.target.value); setSaved(false); }} />
            </label>
          )}
          {error && <p role="alert" className="gs-error">{error}</p>}
          <div className="gs-actions">
            {saved && !changed && <span className="gs-saved">Saved</span>}
            <button type="submit" className="gs-button gs-button-primary" disabled={saving || !changed}>
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </form>
      </section>

      <section className="gs-card gs-danger-card">
        <h2>Owner</h2>
        <p>Hand the group to someone else. You'll stay on as an admin and can leave afterwards.</p>
        <div className="gs-inline">
          <select value={newOwner} onChange={(event) => setNewOwner(event.target.value)}
            aria-label="New owner" disabled={busy || members.length === 0}>
            <option value="">{members.length ? "Choose a member" : "No one else in the group"}</option>
            {members.map((member) => (
              <option key={member.id} value={member.id}>{member.name}</option>
            ))}
          </select>
          <button type="button" className="gs-button" disabled={busy || !newOwner} onClick={handOver}>
            Hand over
          </button>
        </div>
        <p className="gs-spaced">Deleting the group removes every session, recording and comment in it.</p>
        <button type="button" className="gs-button gs-button-danger" disabled={busy} onClick={remove}>
          Delete group
        </button>
        {dangerError && <p role="alert" className="gs-error">{dangerError}</p>}
      </section>
    </>
  );
}

/// The group's invite link, to copy or (where the browser can) share.
function InviteSection({ group }) {
  const [copied, setCopied] = useState(false);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const message = `Join ${group.name} on 8kount`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(group.inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this invite link:", group.inviteUrl);
    }
  };

  const share = () => {
    navigator.share({ title: message, text: message, url: group.inviteUrl }).catch(() => {});
  };

  return (
    <section className="gs-card">
      <h2>Invite people</h2>
      <p>
        Anyone with this link can join
        {group.isPublic ? "." : " once they enter the group password."}
      </p>
      <div className="gs-inline">
        <input className="gs-invite-link" value={group.inviteUrl} readOnly
          aria-label="Invite link" onFocus={(event) => event.target.select()} />
        <button type="button" className="gs-button gs-button-primary" onClick={copy}>
          {copied ? "Copied" : "Copy link"}
        </button>
        {canShare && (
          <button type="button" className="gs-button" onClick={share}>Share</button>
        )}
      </div>
    </section>
  );
}

function LeaveSection({ group, onLeft }) {
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState("");

  const leave = async () => {
    if (!window.confirm(`Leave ${group.name}? You'll need its ID${group.isPublic ? "" : " and password"} to join again.`)) return;
    setLeaving(true);
    setError("");
    try {
      await leaveGroup(group.id);
      onLeft();
    } catch (err) {
      setError(err.message);
      setLeaving(false);
    }
  };

  return (
    <section className="gs-card">
      <h2>Leave group</h2>
      <p>You'll stop seeing its sessions and recordings.</p>
      <button type="button" className="gs-button gs-button-danger" disabled={leaving} onClick={leave}>
        {leaving ? "Leaving..." : "Leave group"}
      </button>
      {error && <p role="alert" className="gs-error">{error}</p>}
    </section>
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

  // A role change saves straight away (it's easy to undo); removing someone
  // asks first.
  const updateMember = async (member, role) => {
    if (!role && !window.confirm(`Remove ${member.name} from this group?`)) return;
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
              // The owner manages everyone else; admins manage members and
              // viewers (the server enforces the same rule).
              const canManage = member.id !== group.owner &&
                member.id !== Number(user.id) &&
                (isOwner || (isAdmin && ["member", "viewer"].includes(member.role)));
              return (
                <li key={member.id}>
                  <span className="gs-member-name">
                    {member.name}
                    {member.id === group.owner && <span className="gs-role">Owner</span>}
                  </span>
                  {canManage ? (
                    <span className="gs-member-actions">
                      <select value={member.role} disabled={saving}
                        aria-label={`Role for ${member.name}`}
                        onChange={(event) => updateMember(member, event.target.value)}>
                        <option value="admin">Admin</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                      <button type="button" className="gs-remove" disabled={saving}
                        aria-label={`Remove ${member.name} from group`}
                        title="Remove from group"
                        onClick={() => updateMember(member, null)} />
                    </span>
                  ) : member.id !== group.owner && (
                    <span className="gs-role">
                      {member.role === "admin" ? "Admin" : member.role === "viewer" ? "Viewer" : "Member"}
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
  .gs-card { padding: 18px 20px; border-radius: 14px; background: #151515; }
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
  .gs-form { display: flex; flex-direction: column; gap: 12px; }
  .gs-form label { display: flex; flex-direction: column; gap: 6px; color: #ddd; font-size: 0.85rem; font-weight: 600; }
  .gs-form input:not([type=checkbox]), .gs-inline select {
    box-sizing: border-box; padding: 8px 10px; border: 1px solid #3a3a3a; border-radius: 7px;
    background: #262626; color: #f0f0f0; font: inherit;
  }
  .gs-form .gs-check { flex-direction: row; align-items: center; gap: 8px; font-weight: 500; }
  .gs-check input { accent-color: var(--accent); width: 16px; height: 16px; }
  .gs-inline { display: flex; flex-wrap: wrap; gap: 10px; }
  .gs-inline select { flex: 1; min-width: 180px; }
  .gs-invite-link {
    flex: 1; min-width: 200px; box-sizing: border-box; padding: 8px 10px;
    border: 1px solid #3a3a3a; border-radius: 7px; background: #262626;
    color: #f0f0f0; font: inherit; font-size: 0.85rem;
  }
  .gs-spaced { margin-top: 18px !important; }
  .gs-button-danger { border-color: #5a2a2a; background: #2a1414; color: #ff8a80; }
  .gs-button-danger:hover { background: #3a1a1a; }
  .gs-members { list-style: none; margin: 0; padding: 0; }
  .gs-members li {
    display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 0; border-top: 1px solid rgba(255,255,255,0.05); overflow-wrap: anywhere;
  }
  .gs-members li:first-child { border-top: none; }
  .gs-role { margin-left: 10px; color: #999; font-size: 0.8rem; }
  .gs-member-actions { display: flex; align-items: center; gap: 10px; }
  .gs-member-actions select {
    padding: 5px 8px; border: 1px solid #3a3a3a; border-radius: 7px;
    background: #262626; color: #f0f0f0; font: inherit; font-size: 0.85rem;
  }
  /* A plain red line, drawn rather than typed so it sits dead center. */
  .gs-remove {
    display: flex; align-items: center; justify-content: center;
    width: 32px; height: 32px; padding: 0; border: none; border-radius: 7px;
    background: transparent; cursor: pointer;
  }
  .gs-remove::before {
    content: ""; width: 16px; height: 3px; border-radius: 2px; background: #e5484d;
  }
  .gs-remove:hover { background: rgba(229, 72, 77, 0.15); }
  .gs-remove:disabled { opacity: 0.5; cursor: default; }
  .gs-pages { display: flex; align-items: center; justify-content: flex-end; gap: 10px; margin-top: 10px; font-size: 0.85rem; }
  @media (max-width: 600px) {
    .gs-banner { flex-direction: column; align-items: flex-start; }
  }
`;

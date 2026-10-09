import { createContext, useCallback, useContext, useEffect, useState } from "react";

import { useAuth } from "../auth/AuthContext.jsx";
import { getGroups, getPrimaryGroupId } from "../api/groups.js";
import { DEFAULT_THEME, applyTheme, themeFor } from "./groupTheme.js";

// Themes the signed-in app in the user's primary group's color (saved on the
// account from Settings or a group's page). No groups falls back to 8kount
// branding.
const GroupThemeContext = createContext(null);

export function GroupThemeProvider({ children }) {
  const { user } = useAuth();
  const [groups, setGroups] = useState([]);

  const refresh = useCallback(async () => {
    const loaded = await getGroups();
    setGroups(loaded);
    return loaded;
  }, []);

  useEffect(() => {
    // A failed load just leaves the 8kount branding in place.
    refresh().catch(() => {});
  }, [refresh, user.id]);

  const activeGroupId = getPrimaryGroupId(user, groups);
  const activeGroup = groups.find((group) => group.id === activeGroupId) ?? null;

  useEffect(() => {
    applyTheme(themeFor(activeGroup));
  }, [activeGroup?.id, activeGroup?.primaryColor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Signing out unmounts the app shell; don't leave a team's colors behind on
  // the sign-in screen.
  useEffect(() => () => applyTheme(DEFAULT_THEME), []);

  const value = {
    activeGroup,
    refresh,
  };

  return (
    <GroupThemeContext.Provider value={value}>
      {children}
    </GroupThemeContext.Provider>
  );
}

export function useGroupTheme() {
  const ctx = useContext(GroupThemeContext);
  if (!ctx) throw new Error("useGroupTheme must be used within a <GroupThemeProvider>");
  return ctx;
}

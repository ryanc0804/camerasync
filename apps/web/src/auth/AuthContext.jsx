import { createContext, useCallback, useContext, useEffect, useState } from "react";

import * as authApi from "../api/auth.js";

// Holds the signed-in user and exposes login/register/logout. Wrap the app in
// <AuthProvider> and read it anywhere with useAuth().
//
// The session lives in an httpOnly cookie the browser manages for us, so there
// is no token in JS. On start-up we ask the server who we are (/me) — until
// that resolves, `loading` is true so the UI doesn't flash the sign-in screen
// at an already-signed-in user.
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    authApi
      .fetchMe()
      .then((u) => {
        if (!cancelled) setUser(u);
      })
      .catch(() => {
        // Server unreachable — treat as signed out rather than blocking the UI.
        if (!cancelled) setUser(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setUser(data.user);
    return data;
  }, []);

  const register = useCallback(async (details) => {
    const data = await authApi.register(details);
    setUser(data.user);
    return data;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      // Clear locally even if the request fails, so the user isn't stuck.
      setUser(null);
    }
  }, []);

  const value = {
    user,
    loading,
    isAuthenticated: Boolean(user),
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within an <AuthProvider>");
  return ctx;
}

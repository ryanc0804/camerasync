import { createContext, useCallback, useContext, useState } from "react";

import * as authApi from "../api/auth.js";

// Holds the signed-in user + token and exposes login/register/logout. Wrap the
// app in <AuthProvider> and read it anywhere with useAuth().
const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => authApi.loadSession());

  const login = useCallback(async (credentials) => {
    const data = await authApi.login(credentials);
    setSession({ token: data.token, user: data.user });
    return data;
  }, []);

  const register = useCallback(async (details) => {
    const data = await authApi.register(details);
    setSession({ token: data.token, user: data.user });
    return data;
  }, []);

  const logout = useCallback(() => {
    authApi.logout();
    setSession(null);
  }, []);

  const value = {
    user: session?.user ?? null,
    token: session?.token ?? null,
    isAuthenticated: Boolean(session?.token),
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

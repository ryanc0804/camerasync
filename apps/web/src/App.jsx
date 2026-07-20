import { Navigate, Route, Routes, useSearchParams } from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthContext.jsx";
import { AppLayout } from "./layouts/AppLayout.jsx";
import { AuthScreen } from "./screens/AuthScreen.jsx";
import { ResetPasswordScreen } from "./screens/ResetPasswordScreen.jsx";
import { RecordScreen } from "./screens/RecordScreen.jsx";
import { CalendarScreen } from "./screens/CalendarScreen.jsx";
import {
  GroupsScreen,
  HomeScreen,
  SettingsScreen,
} from "./screens/PlaceholderScreens.jsx";

export function App() {
  return (
    <AuthProvider>
      <Root />
    </AuthProvider>
  );
}

function Root() {
  const { isAuthenticated, loading } = useAuth();

  // Wait for the /me check so an already-signed-in user doesn't briefly see
  // the sign-in screen on refresh.
  if (loading) return <FullScreenMessage>Loading…</FullScreenMessage>;

  return (
    <Routes>
      {/* Reachable signed out — it's how you recover an account. */}
      <Route path="/reset-password" element={<ResetPasswordRoute />} />

      <Route
        path="/login"
        element={isAuthenticated ? <Navigate to="/" replace /> : <AuthScreen />}
      />

      {/* Everything inside the layout requires a session. */}
      <Route
        element={isAuthenticated ? <AppLayout /> : <Navigate to="/login" replace />}
      >
        <Route path="/" element={<HomeScreen />} />
        <Route path="/groups" element={<GroupsScreen />} />
        <Route path="/record" element={<RecordScreen />} />
        <Route path="/calendar" element={<CalendarScreen />} />
        <Route path="/settings" element={<SettingsScreen />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

// Pulls ?token= out of the reset link's URL.
function ResetPasswordRoute() {
  const [params] = useSearchParams();
  return <ResetPasswordScreen token={params.get("token")} />;
}

function FullScreenMessage({ children }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#0d0d0d",
        color: "#999",
        fontFamily: "system-ui",
      }}
    >
      {children}
    </div>
  );
}

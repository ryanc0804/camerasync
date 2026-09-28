import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // host:true binds every interface so phones on the same Wi-Fi can open the
  // dev server by LAN IP (vite prints the address on startup).
  server: { port: 5173, host: true },
});

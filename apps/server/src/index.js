import "dotenv/config";
import http from "node:http";
import express from "express";
import cors from "cors";
import { Server as SocketServer } from "socket.io";

import { healthRouter } from "./routes/health.js";
import { registerSocketHandlers } from "./sockets/index.js";

const PORT = process.env.PORT || 4000;
const WEB_ORIGIN = process.env.WEB_ORIGIN || "http://localhost:5173";

const app = express();
app.use(cors({ origin: WEB_ORIGIN }));
app.use(express.json());

app.use("/health", healthRouter);

// Status message for root route
app.get("/", async (req, res) => {
  res.status(200).json({"status": "OK"})
})

// REST routes go here as the API grows:
//   app.use("/api/auth", authRouter);
//   app.use("/api/groups", groupsRouter);
//   app.use("/api/sessions", sessionsRouter);

const server = http.createServer(app);

const io = new SocketServer(server, {
  cors: { origin: WEB_ORIGIN },
});
registerSocketHandlers(io);

server.listen(PORT, () => {
  console.log(`[camerasync] server listening on http://localhost:${PORT}`);
  console.log(`[camerasync] socket.io ready, web origin: ${WEB_ORIGIN}`);
});

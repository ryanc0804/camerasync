import { Router } from "express";
import { pingDb } from "../db/pool.js";

export const healthRouter = Router();

// GET /health -> liveness + DB connectivity check.
healthRouter.get("/", async (_req, res) => {
  let db = false;

  try {
    db = await pingDb();
  } catch {
    db = false;
  }
  
  res.json({
    status: "ok",
    db,
    serverTime: Date.now(),
  });
});

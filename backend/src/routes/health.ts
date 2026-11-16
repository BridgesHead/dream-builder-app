import { Router } from "express";
import { config } from "../config.js";
import { getDatabaseStatus } from "../db/connect.js";

export const healthRouter = Router();

// GET /api/v1/health: "Are you alive, and can you reach the database?"
// Used by us, by the AWS uptime checks (AWS-02) and by the load balancer.
// It needs no login and shows no secrets, only the version and the database status.
healthRouter.get("/", (_req, res) => {
  const database = getDatabaseStatus();
  const healthy = database === "connected";

  // 200 = all good. 503 = "Service Unavailable": the server is up, but it can't do
  // real work without the database. Uptime checks treat 503 as "down" and send an alert.
  res.status(healthy ? 200 : 503).json({
    status: healthy ? "ok" : "error",
    version: config.version,
    database,
  });
  return;
});

import express, { Router } from "express";
import cookieParser from "cookie-parser";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();

  // Don't announce "X-Powered-By: Express" on every response; it only helps attackers.
  app.disable("x-powered-by");

  // First, so every request gets an ID and a log line, even ones that fail later.
  app.use(requestLogger);
  // Parse JSON request bodies into req.body (rejects bodies over 100kb by default).
  app.use(express.json());
  // Parse the Cookie header into req.cookies (the refresh token cookie arrives in BE-03).
  app.use(cookieParser());

  // Everything lives under /api/v1. Each story in the guide adds its own router here
  // (auth in BE-03, children in BE-04, stories in BE-08, ...).
  const api = Router();

  api.use("/health", healthRouter);

  app.use("/api/v1", api);

  // No route matched: answer 404 in the shared error shape.
  app.use(notFoundHandler);
  // Must be registered last so it catches errors from everything above.
  app.use(errorHandler);

  return app;
}

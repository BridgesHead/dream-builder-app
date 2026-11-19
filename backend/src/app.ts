import express, { Router } from "express";
import cookieParser from "cookie-parser";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { requestLogger } from "./middleware/requestLogger.js";
import { config } from "./config.js";
import { createAdminRouter } from "./routes/admin.js";
import { createAuthRouter } from "./routes/auth.js";
import { createChildSessionRouter } from "./routes/childSession.js";
import { createChildrenRouter } from "./routes/children.js";
import { createFacilitatorRouter } from "./routes/facilitator.js";
import { createMediaRouter } from "./routes/media.js";
import { createOrdersRouter } from "./routes/orders.js";
import { createPaymentsRouter } from "./routes/payments.js";
import { getStorage } from "./lib/storage.js";
import { createStoriesRouter } from "./routes/stories.js";
import { healthRouter } from "./routes/health.js";

export function createApp() {
  const app = express();

  // Don't announce "X-Powered-By: Express" on every response; it only helps attackers.
  app.disable("x-powered-by");
  // Behind AWS's load balancer, trust its "X-Forwarded-For" header for the caller's real IP.
  app.set("trust proxy", config.trustProxyHops);

  // First, so every request gets an ID and a log line, even ones that fail later.
  app.use(requestLogger);
  // Stripe's webhook (BE-17) BEFORE the JSON parser: its signature is checked against the
  // body exactly as Stripe sent it, so that route reads the raw bytes itself.
  app.use("/api/v1/payments", createPaymentsRouter());
  // Parse JSON request bodies into req.body (rejects bodies over 100kb by default).
  app.use(express.json());
  // Parse the Cookie header into req.cookies (the refresh token cookie).
  app.use(cookieParser());

  // Everything lives under /api/v1. Every route starts with allow(...) (BE-05), which says who may call it.
  // Each story in the guide adds its own router here
  // (stories in BE-08, payments in BE-17, ...).
  const api = Router();

  api.use("/health", healthRouter);
  // Before /auth, so /auth/child-session/... is handled by its own router.
  api.use("/auth/child-session", createChildSessionRouter());
  api.use("/auth", createAuthRouter());
  api.use("/children", createChildrenRouter());
  api.use("/stories", createStoriesRouter());
  api.use("/orders", createOrdersRouter());
  api.use("/facilitator", createFacilitatorRouter());
  api.use("/admin", createAdminRouter());
  // Pictures from the local storage folder, by signed link (BE-10; S3 serves its own on AWS).
  api.use("/media", createMediaRouter(getStorage().kind));

  app.use("/api/v1", api);

  // No route matched: answer 404 in the shared error shape.
  app.use(notFoundHandler);
  // Must be registered last so it catches errors from everything above.
  app.use(errorHandler);

  return app;
}

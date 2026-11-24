import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import { logger } from "../lib/logger.js";

// Writes ONE log line per request when it finishes, e.g.
//   {"msg":"request","requestId":"3f2a...","method":"GET","path":"/api/v1/health","statusCode":200,"durationMs":4}
export const requestLogger: RequestHandler = (req, res, next) => {
  // A random ID per request. It goes in every log line about this request, and back to the
  // caller in the X-Request-Id header, so a reported problem can be found in the logs.
  const requestId = randomUUID();
  res.locals.requestId = requestId;
  res.setHeader("X-Request-Id", requestId);

  const started = performance.now();

  // "finish" fires after the response has been sent.
  res.on("finish", () => {
    logger.info(
      {
        requestId,
        method: req.method,
        // Only the path, never the "?..." part: links like /reset-password?token=... carry secrets.
        path: req.originalUrl.split("?")[0],
        statusCode: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      },
      "request",
    );
  });

  next();
};

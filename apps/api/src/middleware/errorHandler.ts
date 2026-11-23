import type { ErrorRequestHandler, RequestHandler } from "express";
import { AppError, errorBody } from "../lib/errors.js";
import { logger } from "../lib/logger.js";

// For any URL no router matched, e.g. GET /api/v1/banana. Registered after all routes.
export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json(errorBody("NOT_FOUND", "Not found"));
  return;
};

// THE error handler: every error in the app ends up here, and leaves in the shared shape.
// Express recognises an error handler by its 4 arguments (err, req, res, next).
// Express 5 also sends errors thrown inside async handlers here automatically.
export const errorHandler: ErrorRequestHandler = (err, req, res, next) => {
  // If a response already started streaming, let Express close the connection.
  if (res.headersSent) {
    next(err);
    return;
  }

  // 1. Our own errors: we already know the status, code and message.
  if (err instanceof AppError) {
    // 4xx = the caller's mistake, so a short "warn" line is enough.
    logger.warn({ requestId: res.locals.requestId, status: err.status, code: err.code }, err.message);
    res.status(err.status).json(errorBody(err.code, err.message, err.fields));
    return;
  }

  // 2. Errors from Express's JSON reader: broken JSON (400) or a body that's too big (413).
  //    They carry `expose: true` and a 4xx status, so they are the caller's fault, not a bug.
  if (err?.expose === true && err.status >= 400 && err.status < 500) {
    logger.warn({ requestId: res.locals.requestId, status: err.status, type: err.type }, "Bad request body");
    if (err.status === 413) {
      res.status(413).json(errorBody("BODY_TOO_LARGE", "The request body is too large"));
    } else {
      res.status(400).json(errorBody("INVALID_JSON", "The request body is not valid JSON"));
    }
    return;
  }

  // 3. Anything else is a bug we didn't expect. Log everything for us (the stack trace),
  //    but tell the caller nothing about it: stack traces can reveal how our code works.
  logger.error({ requestId: res.locals.requestId, err, method: req.method }, "Unexpected error");
  res.status(500).json(errorBody("INTERNAL_ERROR", "Something went wrong on our side. Please try again."));
};

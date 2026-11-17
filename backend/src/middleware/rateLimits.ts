import type { Request } from "express";
import { ipKeyGenerator, rateLimit } from "express-rate-limit";
import { AppError } from "../lib/errors.js";

// Rate limits (guide BE-03): stop someone trying thousands of passwords or sign-ups.
//
// ⚠️ The counts are kept in this server's memory. That's fine on one server, but on AWS with
// several servers each would count separately, and a restart resets them. They move to a
// shared store (Redis) when BE-07 brings Redis in.

const MINUTE = 60 * 1000;

function tooMany(message: string) {
  return (_req: Request, _res: unknown, next: (err: unknown) => void) => {
    next(new AppError(429, "TOO_MANY_ATTEMPTS", message));
  };
}

// The caller's IP address, in the form express-rate-limit wants (it groups IPv6 addresses
// by network, so one attacker can't dodge the limit by switching between their many IPv6 addresses).
const ipKey = (req: Request) => ipKeyGenerator(req.ip ?? "unknown");

// A fresh set of limiters. createApp() calls this, so every app (and every test) starts
// with clean counts.
export function createAuthRateLimits() {
  return {
    // 10 FAILED logins for one email in 15 minutes → that email is blocked for the rest of the
    // 15 minutes, even with the right password. Successful logins don't count.
    login: rateLimit({
      windowMs: 15 * MINUTE,
      limit: 10,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => {
        const email: unknown = req.body?.email;
        return typeof email === "string" ? `login:${email.trim().toLowerCase()}` : `login-ip:${ipKey(req)}`;
      },
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("Too many failed attempts. Please wait 15 minutes and try again."),
    }),

    // 5 sign-ups per hour from one IP address.
    register: rateLimit({
      windowMs: 60 * MINUTE,
      limit: 5,
      keyGenerator: ipKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("Too many sign-ups from this network. Please try again later."),
    }),

    // Leaving a child session (BE-04): 10 WRONG parent passwords in 15 minutes per parent,
    // so a child can't keep guessing. Runs after allow("child_session"), which sets req.childSession.
    childExit: rateLimit({
      windowMs: 15 * MINUTE,
      limit: 10,
      skipSuccessfulRequests: true,
      keyGenerator: (req) => `child-exit:${req.childSession?.parentId ?? ipKey(req)}`,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("Too many wrong passwords. Please wait 15 minutes and try again."),
    }),

    // 5 "send me an email" requests (forgot password, resend verification) per hour per IP.
    email: rateLimit({
      windowMs: 60 * MINUTE,
      limit: 5,
      keyGenerator: ipKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("Too many emails requested. Please try again later."),
    }),
  };
}

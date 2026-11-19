import type { Request } from "express";
import { ipKeyGenerator, rateLimit, type Store } from "express-rate-limit";
import { RedisStore, type RedisReply } from "rate-limit-redis";
import { config } from "../config.js";
import { AppError } from "../lib/errors.js";
import { getRedis } from "../lib/redis.js";

// Rate limits (guide BE-03): stop someone trying thousands of passwords or sign-ups.
//
// Where the counts live (BE-07): in Redis when REDIS_URL is set, so every server on AWS shares
// one count and a restart doesn't reset it. Without Redis (your PC) they're kept in memory.
// Tests always use memory, so each test app starts with clean counts.

const MINUTE = 60 * 1000;

function storeFor(name: string): { store?: Store } {
  if (!config.redisUrl || config.nodeEnv === "test") return {};
  const redis = getRedis();
  return {
    store: new RedisStore({
      prefix: `rate-limit:${name}:`,
      sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as Promise<RedisReply>,
    }),
  };
}

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
      ...storeFor("login"),
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
      ...storeFor("register"),
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
      ...storeFor("childExit"),
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
      ...storeFor("email"),
      windowMs: 60 * MINUTE,
      limit: 5,
      keyGenerator: ipKey,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("Too many emails requested. Please try again later."),
    }),
  };
}

// Story review limits (BE-12). Each sentence rewrite is an AI call that costs money, so one
// child gets 30 in 15 minutes: plenty for polishing a story, not enough to run up a bill.
export function createStoryRateLimits() {
  return {
    rewrite: rateLimit({
      ...storeFor("rewrite"),
      windowMs: 15 * MINUTE,
      limit: 30,
      keyGenerator: (req) => `rewrite:${req.childSession?.childId ?? ipKey(req)}`,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      handler: tooMany("That's a lot of sentence help! Take a little break and try again soon."),
    }),
  };
}

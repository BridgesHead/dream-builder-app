// BE-05 access matrix: EVERY route, called as EVERY kind of caller, checking each allow or refuse.
//
// To add a route: add a line to MATRIX below with who may call it. If you forget, the
// "every route is in the matrix" test fails, so a route can't ship without an explicit rule.
import type { Express } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { closeQueue } from "../../src/jobs/queue.js";
import { closeRedis } from "../../src/lib/redis.js";
import { ALL_MODELS } from "../../src/db/models/index.js";
import { accessRuleOf, WHO, type Who } from "../../src/middleware/access.js";
import { bearer, makeChild, makeChildSession, makeUser } from "../helpers/actors.js";

// The kinds of caller.
const CALLERS = ["anonymous", "unverified_parent", "parent", "child_session", "facilitator", "admin"] as const;
type Caller = (typeof CALLERS)[number];
const EVERYONE = [...CALLERS];

// A made-up id for :params. Callers who are let in then get 404 or 400, never a real change.
const NO_SUCH_ID = "665f1c2ab0d4e1a2b3c4d5e6";

interface Entry {
  method: "get" | "post" | "patch" | "delete";
  mount: string; // where the router is mounted, under /api/v1
  path: string; // the route's path inside its router
  rule: Who[]; // the allow(...) we expect on the route
  callers: readonly Caller[]; // who should get past the access check
}

const MATRIX: Entry[] = [
  { method: "get", mount: "/health", path: "/", rule: ["public"], callers: EVERYONE },

  { method: "post", mount: "/auth", path: "/register", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/login", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/refresh", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/logout", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/verify-email", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/resend-verification", rule: ["parent"], callers: ["unverified_parent", "parent"] },
  { method: "post", mount: "/auth", path: "/forgot-password", rule: ["public"], callers: EVERYONE },
  { method: "post", mount: "/auth", path: "/reset-password", rule: ["public"], callers: EVERYONE },
  { method: "get", mount: "/auth", path: "/me", rule: ["parent", "facilitator", "admin"], callers: ["unverified_parent", "parent", "facilitator", "admin"] },

  { method: "post", mount: "/auth/child-session", path: "/", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/auth/child-session", path: "/exit", rule: ["child_session"], callers: ["child_session"] },

  { method: "get", mount: "/children", path: "/", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/children", path: "/", rule: ["verified_parent"], callers: ["parent"] },
  { method: "get", mount: "/children", path: "/:id", rule: ["verified_parent"], callers: ["parent"] },
  { method: "patch", mount: "/children", path: "/:id", rule: ["verified_parent"], callers: ["parent"] },
  // BE-16: deleting a child's data (with the parent's password), and following the request.
  { method: "get", mount: "/children", path: "/:id/deletion-preview", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/children", path: "/:id/deletion", rule: ["verified_parent"], callers: ["parent"] },
  { method: "get", mount: "/deletion-requests", path: "/:id", rule: ["verified_parent"], callers: ["parent"] },

  { method: "post", mount: "/stories", path: "/", rule: ["child_session"], callers: ["child_session"] },
  { method: "get", mount: "/stories", path: "/", rule: ["child_session", "verified_parent"], callers: ["child_session", "parent"] },
  { method: "get", mount: "/stories", path: "/:id", rule: ["child_session", "verified_parent"], callers: ["child_session", "parent"] },
  { method: "patch", mount: "/stories", path: "/:id", rule: ["child_session"], callers: ["child_session"] },
  { method: "post", mount: "/stories", path: "/:id/generate", rule: ["child_session"], callers: ["child_session"] },
  { method: "post", mount: "/stories", path: "/:id/generate/retry", rule: ["child_session"], callers: ["child_session"] },
  { method: "get", mount: "/stories", path: "/:id/status", rule: ["child_session", "verified_parent"], callers: ["child_session", "parent"] },
  { method: "get", mount: "/stories", path: "/:id/panels/:number/image", rule: ["child_session", "verified_parent"], callers: ["child_session", "parent"] },
  // BE-12 draft review: the child edits and submits, the parent comments and approves.
  { method: "patch", mount: "/stories", path: "/:id/panels/:number", rule: ["child_session"], callers: ["child_session"] },
  { method: "patch", mount: "/stories", path: "/:id/comic-cells/:page/:cell", rule: ["child_session"], callers: ["child_session"] },
  { method: "post", mount: "/stories", path: "/:id/panels/:number/redraw", rule: ["child_session"], callers: ["child_session"] },
  { method: "post", mount: "/stories", path: "/:id/panels/:number/rewrite", rule: ["child_session"], callers: ["child_session"] },
  { method: "post", mount: "/stories", path: "/:id/submit", rule: ["child_session"], callers: ["child_session"] },
  { method: "get", mount: "/stories", path: "/:id/comments", rule: ["child_session", "verified_parent"], callers: ["child_session", "parent"] },
  { method: "post", mount: "/stories", path: "/:id/comments", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/stories", path: "/:id/approve", rule: ["verified_parent"], callers: ["parent"] },

  // BE-17 orders: parents only. The webhook is public: Stripe's signature is the permission.
  { method: "get", mount: "/orders", path: "/prices", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/orders", path: "/", rule: ["verified_parent"], callers: ["parent"] },
  { method: "get", mount: "/orders", path: "/", rule: ["verified_parent"], callers: ["parent"] },
  { method: "get", mount: "/orders", path: "/:id", rule: ["verified_parent"], callers: ["parent"] },
  // BE-18: the book PDF link (another parent's order is 404).
  { method: "get", mount: "/orders", path: "/:id/download", rule: ["verified_parent"], callers: ["parent"] },
  { method: "post", mount: "/payments", path: "/stripe/webhook", rule: ["public"], callers: EVERYONE },

  // The signed link is the permission (an <img> tag can't send a token).
  { method: "get", mount: "/media", path: "/*key", rule: ["public"], callers: EVERYONE },

  { method: "get", mount: "/facilitator", path: "/children", rule: ["facilitator"], callers: ["facilitator"] },
  { method: "get", mount: "/facilitator", path: "/children/:childId/stories", rule: ["facilitator"], callers: ["facilitator"] },
  { method: "get", mount: "/facilitator", path: "/stories/:storyId", rule: ["facilitator"], callers: ["facilitator"] },

  { method: "get", mount: "/admin", path: "/audit-log", rule: ["admin"], callers: ["admin"] },
  { method: "get", mount: "/admin", path: "/stories/:storyId", rule: ["admin"], callers: ["admin"] },
  { method: "get", mount: "/admin", path: "/stories/:storyId/progress", rule: ["admin"], callers: ["admin"] },
];

// Every route Express knows about, with the allow(...) rule on its first handler.
interface FoundRoute {
  method: string;
  path: string;
  rule: readonly Who[] | undefined;
}
function findRoutes(app: Express): FoundRoute[] {
  const found: FoundRoute[] = [];
  type Layer = { route?: { path: string; methods: Record<string, boolean>; stack: { handle: unknown }[] }; handle?: { stack?: Layer[] } };
  const walk = (stack: Layer[]) => {
    for (const layer of stack) {
      if (layer.route) {
        for (const method of Object.keys(layer.route.methods)) {
          found.push({ method, path: layer.route.path, rule: accessRuleOf(layer.route.stack[0]?.handle) });
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack);
      }
    }
  };
  walk((app as unknown as { router: { stack: Layer[] } }).router.stack);
  return found;
}

const tokens: Partial<Record<Caller, string>> = {};

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));

  const parent = await makeUser("parent");
  const childId = await makeChild(parent.id);
  tokens.parent = parent.token;
  tokens.unverified_parent = (await makeUser("parent", { verified: false })).token;
  tokens.child_session = await makeChildSession(parent.id, childId);
  tokens.facilitator = (await makeUser("facilitator")).token;
  tokens.admin = (await makeUser("admin")).token;
});

afterAll(async () => {
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
});

describe("no route ships without an explicit rule", () => {
  const routes = findRoutes(createApp());

  it("every route starts with allow(...)", () => {
    const missing = routes.filter((r) => !r.rule).map((r) => `${r.method.toUpperCase()} ${r.path}`);
    expect(missing).toEqual([]);
    for (const r of routes) for (const who of r.rule!) expect(WHO).toContain(who);
  });

  it("every route is in the matrix, with the rule the matrix expects", () => {
    const key = (method: string, path: string, rule: readonly Who[] | undefined) => `${method} ${path} ${[...(rule ?? [])].sort().join("+")}`;
    const actual = routes.map((r) => key(r.method, r.path, r.rule)).sort();
    const expected = MATRIX.map((e) => key(e.method, e.path, e.rule)).sort();
    expect(actual).toEqual(expected);
  });
});

describe.each(CALLERS)("called as %s", (caller) => {
  // A fresh app per caller = fresh rate-limit counts.
  const app = createApp();

  it.each(MATRIX.map((e) => [`${e.method.toUpperCase()} ${e.mount}${e.path}`, e] as const))("%s", async (_name, entry) => {
    const url = `/api/v1${entry.mount}${entry.path}`.replace(/:[a-zA-Z]+/g, NO_SUCH_ID).replace(/\/$/, "");
    let call = request(app)[entry.method](url);
    if (caller !== "anonymous") call = call.set(bearer(tokens[caller]!));
    // An empty body: callers who are let in stop at validation (400), so nothing changes.
    const res = entry.method === "get" || entry.method === "delete" ? await call : await call.send({});

    const allowed = entry.callers.includes(caller);
    if (allowed) {
      // Public routes may answer 401 for their own reasons (e.g. refresh with no cookie),
      // but never 403.
      expect(res.status).not.toBe(403);
      if (!entry.rule.includes("public")) expect(res.status).not.toBe(401);
    } else {
      expect([401, 403]).toContain(res.status);
      // Not logged in → 401. Logged in as the wrong kind → 403.
      expect(res.status).toBe(caller === "anonymous" ? 401 : 403);
    }
  });
});

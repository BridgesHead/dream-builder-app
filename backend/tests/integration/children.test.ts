// BE-04: child profiles and child sessions, against a real (test) MongoDB.
import express, { type Express } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Child, Consent, Session, User } from "../../src/db/models/index.js";
import { hashPassword } from "../../src/lib/password.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { allow, assertOwnChild } from "../../src/middleware/access.js";

const PASSWORD = "Rocket123";

let app: Express;
let counter = 0;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await disconnectFromDatabase();
});

// A fresh app per test = fresh rate-limit counts.
beforeEach(() => {
  app = createApp();
});

type Agent = ReturnType<typeof request.agent>;

// A verified parent with consent, logged in. `agent` keeps their cookies like a browser.
async function parent(options: { verified?: boolean } = {}) {
  const email = `parent${++counter}.${Date.now()}@example.com`;
  const user = await User.create({
    email,
    name: "Sarah Jenkins",
    passwordHash: await hashPassword(PASSWORD),
    emailVerifiedAt: options.verified === false ? null : new Date(),
  });
  await Consent.create({ parentId: user._id, textVersion: "test-v1", method: "email_verification", ipAddress: "127.0.0.1" });

  const agent = request.agent(app);
  const login = await agent.post("/api/v1/auth/login").send({ email, password: PASSWORD });
  expect(login.status).toBe(200);
  return { agent, email, id: String(user._id), token: login.body.accessToken as string };
}

const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

async function addChild(p: { agent: Agent; token: string }, body: Record<string, unknown> = {}) {
  const res = await p.agent
    .post("/api/v1/children")
    .set(bearer(p.token))
    .send({ name: "Alex", age: 8, language: "English", ...body });
  expect(res.status).toBe(201);
  return res.body.child as { id: string; name: string; age: number; language: string; mode: string };
}

// A tiny test-only app: answers 200 only to an open child session.
function pingApp() {
  const mini = express();
  mini.get("/ping", allow("child_session"), (_req, res) => {
    res.json({ ok: true });
    return;
  });
  mini.use(errorHandler);
  return mini;
}

async function handOver(p: { agent: Agent; token: string }, childId: string) {
  const res = await p.agent.post("/api/v1/auth/child-session").set(bearer(p.token)).send({ childId });
  expect(res.status).toBe(201);
  return res.body.accessToken as string;
}

describe("child profiles: create, read, update, remove", () => {
  it("adds a child and lists only the parent's own children", async () => {
    const sarah = await parent();
    const bob = await parent();
    const alex = await addChild(sarah);
    await addChild(sarah, { name: "Maya", age: 14 });
    await addChild(bob, { name: "Bobby" });

    expect(alex).toEqual({ id: expect.any(String), name: "Alex", age: 8, language: "English", mode: "junior" });

    const list = await sarah.agent.get("/api/v1/children").set(bearer(sarah.token));
    expect(list.status).toBe(200);
    expect(list.body.children.map((c: { name: string }) => c.name)).toEqual(["Alex", "Maya"]);
  });

  it("another parent's child, a nonsense id and a missing id are all 404", async () => {
    const sarah = await parent();
    const bob = await parent();
    const bobby = await addChild(bob, { name: "Bobby" });

    for (const id of [bobby.id, "abc", "665f1c2ab0d4e1a2b3c4d5e6"]) {
      const get = await sarah.agent.get(`/api/v1/children/${id}`).set(bearer(sarah.token));
      const patch = await sarah.agent.patch(`/api/v1/children/${id}`).set(bearer(sarah.token)).send({ name: "Mine now" });
      const del = await sarah.agent.delete(`/api/v1/children/${id}`).set(bearer(sarah.token));
      expect([get.status, patch.status, del.status]).toEqual([404, 404, 404]);
      expect(get.body.error.code).toBe("NOT_FOUND");
    }
    // Bob's child is untouched.
    expect((await Child.findById(bobby.id).lean())?.name).toBe("Bobby");
  });

  it("the owner comes from the login, never from the body", async () => {
    const sarah = await parent();
    const bob = await parent();
    const res = await sarah.agent
      .post("/api/v1/children")
      .set(bearer(sarah.token))
      .send({ name: "Alex", age: 8, language: "English", parentId: bob.id });
    expect(res.status).toBe(400);
    expect(await Child.countDocuments({ parentId: bob.id })).toBe(0);
  });

  it("age must be a whole number from 8 to 14", async () => {
    const sarah = await parent();
    for (const age of [7, 15, 9.5, "10"]) {
      const res = await sarah.agent.post("/api/v1/children").set(bearer(sarah.token)).send({ name: "Alex", age, language: "English" });
      expect(res.status).toBe(400);
      expect(res.body.error.fields.age).toBeDefined();
    }
  });

  it("mode defaults from age, but the parent's choice is what gets stored", async () => {
    const sarah = await parent();
    expect((await addChild(sarah, { age: 11 })).mode).toBe("junior");
    expect((await addChild(sarah, { age: 12 })).mode).toBe("senior");
    expect((await addChild(sarah, { age: 13, mode: "junior" })).mode).toBe("junior");
    expect((await addChild(sarah, { age: 9, mode: "senior" })).mode).toBe("senior");
  });

  it("editing changes only what was sent; a new age keeps the stored mode", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah, { age: 11 });

    const res = await sarah.agent.patch(`/api/v1/children/${alex.id}`).set(bearer(sarah.token)).send({ age: 12 });
    expect(res.status).toBe(200);
    expect(res.body.child).toMatchObject({ name: "Alex", age: 12, mode: "junior" });

    const switched = await sarah.agent.patch(`/api/v1/children/${alex.id}`).set(bearer(sarah.token)).send({ mode: "senior" });
    expect(switched.body.child.mode).toBe("senior");

    const empty = await sarah.agent.patch(`/api/v1/children/${alex.id}`).set(bearer(sarah.token)).send({});
    expect(empty.status).toBe(400);
  });

  it("removing a child is a soft delete, and it's logged", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);

    const res = await sarah.agent.delete(`/api/v1/children/${alex.id}`).set(bearer(sarah.token));
    expect(res.status).toBe(204);

    // Hidden from the API ...
    const list = await sarah.agent.get("/api/v1/children").set(bearer(sarah.token));
    expect(list.body.children).toEqual([]);
    expect((await sarah.agent.get(`/api/v1/children/${alex.id}`).set(bearer(sarah.token))).status).toBe(404);
    // ... but still in the database, marked as removed.
    expect((await Child.findById(alex.id).lean())?.deletedAt).toBeInstanceOf(Date);

    // The audit log: who, what, which child, from where.
    const entry = await AuditLog.findOne({ action: "child.delete", targetId: alex.id }).lean();
    expect(entry).toMatchObject({ actorId: new mongoose.Types.ObjectId(sarah.id), actorRole: "parent", targetType: "child" });
    expect(entry?.ipAddress).toBeTruthy();
    expect(await AuditLog.exists({ action: "child.create", targetId: alex.id })).toBeTruthy();
  });

  it("needs a verified parent", async () => {
    const unverified = await parent({ verified: false });
    const res = await unverified.agent.get("/api/v1/children").set(bearer(unverified.token));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    expect((await request(app).get("/api/v1/children")).status).toBe(401);
  });
});

describe("child sessions", () => {
  it("handover gives a kids' wristband and ends the parent session on this device", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);

    const res = await sarah.agent.post("/api/v1/auth/child-session").set(bearer(sarah.token)).send({ childId: alex.id });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ kind: "child", child: { id: alex.id, name: "Alex", mode: "junior" } });
    // No parent details are handed to the child.
    expect(JSON.stringify(res.body)).not.toContain("@example.com");

    // Only the child session is left for Sarah.
    const sessions = await Session.find({ userId: sarah.id }).lean();
    expect(sessions.map((s) => String(s.childId))).toEqual([alex.id]);

    // A reload (refresh with the cookie) gives a kids' wristband again, never a parent one.
    const refresh = await sarah.agent.post("/api/v1/auth/refresh");
    expect(refresh.status).toBe(200);
    expect(refresh.body.kind).toBe("child");
    expect(refresh.body.user).toBeUndefined();
  });

  it("a parent can't hand over another parent's child", async () => {
    const sarah = await parent();
    const bob = await parent();
    const bobby = await addChild(bob);
    for (const childId of [bobby.id, "abc"]) {
      const res = await sarah.agent.post("/api/v1/auth/child-session").set(bearer(sarah.token)).send({ childId });
      expect(res.status).toBe(404);
    }
  });

  it("a kids' wristband is refused by parent account, children and child-session routes", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);
    const maya = await addChild(sarah, { name: "Maya", age: 14 });
    const kid = await handOver(sarah, alex.id);
    const as = bearer(kid);

    const tries = [
      await request(app).get("/api/v1/auth/me").set(as),
      await request(app).post("/api/v1/auth/resend-verification").set(as),
      await request(app).get("/api/v1/children").set(as),
      await request(app).get(`/api/v1/children/${maya.id}`).set(as),
      await request(app).post("/api/v1/children").set(as).send({ name: "Sneaky", age: 9, language: "English" }),
      await request(app).delete(`/api/v1/children/${alex.id}`).set(as),
      await request(app).post("/api/v1/auth/child-session").set(as).send({ childId: maya.id }),
    ];
    expect(tries.map((r) => r.status)).toEqual([403, 403, 403, 403, 403, 403, 403]);
    expect(tries[0].body.error.code).toBe("FORBIDDEN");
    expect(await Child.countDocuments({ parentId: sarah.id, deletedAt: null })).toBe(2);
  });

  it("a kids' wristband reaches only its own child's things (the guard BE-08 story routes use)", async () => {
    // A small test-only app with a route shaped like the BE-08 story routes.
    const mini = express();
    mini.get("/children/:childId/stories", allow("child_session"), (req, res) => {
      assertOwnChild(req, String(req.params.childId));
      res.json({ ok: true, childId: req.childSession!.childId });
      return;
    });
    mini.use(errorHandler);

    const sarah = await parent();
    const alex = await addChild(sarah);
    const maya = await addChild(sarah, { name: "Maya", age: 14 });
    const kid = bearer(await handOver(sarah, alex.id));

    expect((await request(mini).get(`/children/${alex.id}/stories`).set(kid)).status).toBe(200);
    expect((await request(mini).get(`/children/${maya.id}/stories`).set(kid)).status).toBe(404);

    // A parent wristband isn't a child session.
    const bob = await parent();
    expect((await request(mini).get(`/children/${alex.id}/stories`).set(bearer(bob.token))).status).toBe(403);
  });

  it("removing the child ends the child session straight away", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);
    const kid = bearer(await handOver(sarah, alex.id));
    expect((await request(pingApp()).get("/ping").set(kid)).status).toBe(200);

    // Sarah removes Alex from her phone (a second login).
    const phone = await request.agent(app).post("/api/v1/auth/login").send({ email: sarah.email, password: PASSWORD });
    const del = await request(app).delete(`/api/v1/children/${alex.id}`).set(bearer(phone.body.accessToken));
    expect(del.status).toBe(204);

    expect((await request(pingApp()).get("/ping").set(kid)).status).toBe(401);
    expect(await Session.countDocuments({ childId: alex.id })).toBe(0);
  });

  it("leaving needs the parent's password and returns a fresh parent session", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);
    const kid = bearer(await handOver(sarah, alex.id));

    const wrong = await sarah.agent.post("/api/v1/auth/child-session/exit").set(kid).send({ password: "guess123" });
    expect(wrong.status).toBe(401);
    expect(wrong.body.error.code).toBe("INVALID_CREDENTIALS");

    const missing = await sarah.agent.post("/api/v1/auth/child-session/exit").set(kid).send({});
    expect(missing.status).toBe(400);

    const right = await sarah.agent.post("/api/v1/auth/child-session/exit").set(kid).send({ password: PASSWORD });
    expect(right.status).toBe(200);
    expect(right.body).toMatchObject({ kind: "parent", user: { id: sarah.id, role: "parent" } });

    // The new parent wristband works; the old kids' wristband doesn't.
    expect((await request(app).get("/api/v1/auth/me").set(bearer(right.body.accessToken))).status).toBe(200);
    expect((await request(pingApp()).get("/ping").set(kid)).status).toBe(401);

    // The cookie is a parent one again.
    const refresh = await sarah.agent.post("/api/v1/auth/refresh");
    expect(refresh.body.kind).toBe("parent");
    expect(await AuditLog.exists({ action: "child_session.exit", targetId: alex.id })).toBeTruthy();
  });

  it("a parent wristband can't use the exit route", async () => {
    const sarah = await parent();
    const res = await sarah.agent.post("/api/v1/auth/child-session/exit").set(bearer(sarah.token)).send({ password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("too many wrong passwords block the exit for a while, even the right one", async () => {
    const sarah = await parent();
    const alex = await addChild(sarah);
    const kid = bearer(await handOver(sarah, alex.id));

    for (let i = 0; i < 10; i++) {
      const res = await sarah.agent.post("/api/v1/auth/child-session/exit").set(kid).send({ password: `guess${i}` });
      expect(res.status).toBe(401);
    }
    const blocked = await sarah.agent.post("/api/v1/auth/child-session/exit").set(kid).send({ password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");
  });
});

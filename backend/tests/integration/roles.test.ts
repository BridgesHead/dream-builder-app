// BE-05: facilitators, admins, the audit log and the staff script, against a real (test) MongoDB.
import type { Express } from "express";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Child, FacilitatorLink, Session, User } from "../../src/db/models/index.js";
import { outbox } from "../../src/services/email.js";
import { createStaffUser, linkFacilitator, setRole, unlinkFacilitator } from "../../src/services/userAdmin.js";
import { bearer, linkToChild, makeChild, makeChildSession, makeStory, makeUser, TEST_PASSWORD } from "../helpers/actors.js";

let app: Express;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await disconnectFromDatabase();
});

beforeEach(() => {
  app = createApp();
});

// The audit entries written while `action` runs.
async function auditDuring(action: () => Promise<unknown>) {
  const before = new Date(Date.now() - 1);
  const ids = new Set((await AuditLog.find().select("_id").lean()).map((e) => String(e._id)));
  await action();
  const all = await AuditLog.find({ createdAt: { $gte: before } }).lean();
  return all.filter((e) => !ids.has(String(e._id)));
}

describe("facilitator: read-only, linked children only", () => {
  it("sees linked children and their story history, nothing else", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id, "Alex");
    const maya = await makeChild(parent.id, "Maya", 14);
    const story = await makeStory(alex);
    await makeStory(maya);
    const teacher = await makeUser("facilitator");
    await linkToChild(teacher.id, alex);
    const as = bearer(teacher.token);

    const children = await request(app).get("/api/v1/facilitator/children").set(as);
    expect(children.status).toBe(200);
    expect(children.body.children.map((c: { name: string }) => c.name)).toEqual(["Alex"]);
    // No parent details reach the facilitator.
    expect(JSON.stringify(children.body)).not.toContain("@example.com");

    const history = await request(app).get(`/api/v1/facilitator/children/${alex}/stories`).set(as);
    expect(history.status).toBe(200);
    expect(history.body.stories).toEqual([expect.objectContaining({ id: story, title: "Pip and the Dragon", status: "draft" })]);

    // Maya isn't linked: the same 404 as a child that doesn't exist.
    expect((await request(app).get(`/api/v1/facilitator/children/${maya}/stories`).set(as)).status).toBe(404);
    expect((await request(app).get("/api/v1/facilitator/children/abc/stories").set(as)).status).toBe(404);
  });

  it("opens a linked child's story (one audit entry) but not anyone else's", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id);
    const other = await makeChild(parent.id, "Maya", 14);
    const story = await makeStory(alex);
    const otherStory = await makeStory(other);
    const teacher = await makeUser("facilitator");
    await linkToChild(teacher.id, alex);

    let res!: request.Response;
    const entries = await auditDuring(async () => {
      res = await request(app).get(`/api/v1/facilitator/stories/${story}`).set(bearer(teacher.token));
    });
    expect(res.status).toBe(200);
    expect(res.body.story).toMatchObject({ id: story, title: "Pip and the Dragon" });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorRole: "facilitator", action: "story.view", targetType: "story", targetId: story });
    expect(String(entries[0].actorId)).toBe(teacher.id);

    expect((await request(app).get(`/api/v1/facilitator/stories/${otherStory}`).set(bearer(teacher.token))).status).toBe(404);
  });

  it("can't edit, approve or delete anything: 403", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id);
    const teacher = await makeUser("facilitator");
    await linkToChild(teacher.id, alex);
    const as = bearer(teacher.token);

    // Every route that changes something today. Story edit, redraw and approve routes join the
    // access matrix when BE-08, BE-11 and BE-12 add them.
    const tries = [
      await request(app).post("/api/v1/children").set(as).send({ name: "New", age: 9, language: "English" }),
      await request(app).patch(`/api/v1/children/${alex}`).set(as).send({ name: "Changed" }),
      await request(app).delete(`/api/v1/children/${alex}`).set(as),
      await request(app).post("/api/v1/auth/child-session").set(as).send({ childId: alex }),
    ];
    expect(tries.map((r) => r.status)).toEqual([403, 403, 403, 403]);
    expect((await Child.findById(alex).lean())).toMatchObject({ name: "Alex", deletedAt: null });
  });

  it("a child removed by their parent disappears from the portal", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id);
    const teacher = await makeUser("facilitator");
    await linkToChild(teacher.id, alex);
    await request(app).delete(`/api/v1/children/${alex}`).set(bearer(parent.token));

    const res = await request(app).get("/api/v1/facilitator/children").set(bearer(teacher.token));
    expect(res.body.children).toEqual([]);
  });
});

describe("admin", () => {
  it("opens any story, with one audit entry", async () => {
    const parent = await makeUser("parent");
    const story = await makeStory(await makeChild(parent.id));
    const admin = await makeUser("admin");

    let res!: request.Response;
    const entries = await auditDuring(async () => {
      res = await request(app).get(`/api/v1/admin/stories/${story}`).set(bearer(admin.token));
    });
    expect(res.status).toBe(200);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorRole: "admin", action: "story.view", targetId: story });

    expect((await request(app).get("/api/v1/admin/stories/abc").set(bearer(admin.token))).status).toBe(404);
  });

  it("reads the audit log, newest first, with filters and pages", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id);
    const admin = await makeUser("admin");
    await request(app).patch(`/api/v1/children/${alex}`).set(bearer(parent.token)).send({ name: "Alexander" });
    await request(app).patch(`/api/v1/children/${alex}`).set(bearer(parent.token)).send({ age: 9 });

    const res = await request(app)
      .get(`/api/v1/admin/audit-log?targetType=child&targetId=${alex}&limit=1`)
      .set(bearer(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(1);
    const [newest] = res.body.entries;
    expect(newest).toMatchObject({ actorId: parent.id, actorRole: "parent", action: "child.update", targetId: alex });
    expect(newest.createdAt).toBeTruthy();

    const next = await request(app)
      .get(`/api/v1/admin/audit-log?targetType=child&targetId=${alex}&before=${newest.id}`)
      .set(bearer(admin.token));
    expect(next.body.entries).toHaveLength(1);
    expect(next.body.entries[0].id).not.toBe(newest.id);

    expect((await request(app).get("/api/v1/admin/audit-log?limit=5000").set(bearer(admin.token))).status).toBe(400);
  });

  it("no API route can change or delete an audit entry, not even an admin's", async () => {
    const parent = await makeUser("parent");
    await makeChild(parent.id);
    const admin = await makeUser("admin");
    const entry = await AuditLog.findOne().lean();
    const count = await AuditLog.countDocuments();
    const as = bearer(admin.token);

    const tries = [
      await request(app).delete(`/api/v1/admin/audit-log/${entry!._id}`).set(as),
      await request(app).patch(`/api/v1/admin/audit-log/${entry!._id}`).set(as).send({ action: "nothing.happened" }),
      await request(app).put(`/api/v1/admin/audit-log/${entry!._id}`).set(as).send({ action: "nothing.happened" }),
      await request(app).post("/api/v1/admin/audit-log").set(as).send({ action: "fake.entry" }),
      await request(app).delete("/api/v1/admin/audit-log").set(as),
    ];
    expect(tries.map((r) => r.status)).toEqual([404, 404, 404, 404, 404]);
    expect(await AuditLog.countDocuments()).toBe(count);
    expect(await AuditLog.findById(entry!._id).lean()).toEqual(entry);
  });
});

describe("each listed action writes exactly one audit entry", () => {
  it("sign-in (any role), with who, what, which record, when and from where", async () => {
    for (const role of ["parent", "facilitator", "admin"] as const) {
      const user = await makeUser(role);
      const entries = await auditDuring(() => request(app).post("/api/v1/auth/login").send({ email: user.email, password: TEST_PASSWORD }));
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorRole: role, action: "auth.sign_in", targetType: "user", targetId: user.id });
      expect(String(entries[0].actorId)).toBe(user.id);
      expect(entries[0].ipAddress).toBeTruthy();
      expect(entries[0].createdAt).toBeInstanceOf(Date);
    }
    // A failed login is not a sign-in.
    const user = await makeUser("parent");
    expect(await auditDuring(() => request(app).post("/api/v1/auth/login").send({ email: user.email, password: "Wrong1234" }))).toHaveLength(0);
  });

  it("consent (at sign-up)", async () => {
    const email = `new.${Date.now()}@example.com`;
    const entries = await auditDuring(() =>
      request(app).post("/api/v1/auth/register").send({ name: "Sarah", email, password: TEST_PASSWORD, adultConfirmed: true, consent: true }),
    );
    expect(entries.map((e) => e.action)).toEqual(["consent.record"]);
    expect(entries[0]).toMatchObject({ actorRole: "parent", targetType: "consent" });
  });

  it("child profile changes and child sessions", async () => {
    const parent = await makeUser("parent");
    const as = bearer(parent.token);
    let childId = "";

    const created = await auditDuring(async () => {
      const res = await request(app).post("/api/v1/children").set(as).send({ name: "Alex", age: 8, language: "English" });
      childId = res.body.child.id;
    });
    const updated = await auditDuring(() => request(app).patch(`/api/v1/children/${childId}`).set(as).send({ age: 9 }));
    const started = await auditDuring(() => request(app).post("/api/v1/auth/child-session").set(as).send({ childId }));
    const kid = await makeChildSession(parent.id, childId);
    const exited = await auditDuring(() => request(app).post("/api/v1/auth/child-session/exit").set(bearer(kid)).send({ password: TEST_PASSWORD }));
    const removed = await auditDuring(() => request(app).delete(`/api/v1/children/${childId}`).set(as));

    for (const [entries, action] of [
      [created, "child.create"],
      [updated, "child.update"],
      [started, "child_session.start"],
      [exited, "child_session.exit"],
      [removed, "child.delete"],
    ] as const) {
      expect(entries.map((e) => e.action)).toEqual([action]);
      expect(entries[0]).toMatchObject({ actorRole: "parent", targetType: "child", targetId: childId });
    }
  });

  it("no story text or secrets end up in the audit log", async () => {
    const all = JSON.stringify(await AuditLog.find().lean());
    expect(all).not.toContain(TEST_PASSWORD);
    expect(all).not.toContain("Pip and the Dragon");
    expect(all).not.toMatch(/eyJ[\w-]+\.[\w-]+\./); // no JWTs
  });
});

describe("staff script (scripts/users.ts)", () => {
  it("creates an admin with a 'set your password' email, and one audit entry", async () => {
    const email = `ali.${Date.now()}@example.com`;
    const entries = await auditDuring(() => createStaffUser({ role: "admin", email, name: "Ali Khan" }));

    const user = await User.findOne({ email }).lean();
    expect(user).toMatchObject({ role: "admin", name: "Ali Khan" });
    expect(user?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(outbox.some((m) => m.to === email && /reset-password\?token=/.test(m.text))).toBe(true);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ actorId: null, actorRole: "system", action: "user.create", targetId: String(user!._id) });

    await expect(createStaffUser({ role: "admin", email, name: "Again" })).rejects.toThrow(/already has an account/);
    await expect(createStaffUser({ role: "parent", email: "p@example.com", name: "P" })).rejects.toThrow(/Parents sign up/);
    await expect(createStaffUser({ role: "superuser", email: "s@example.com", name: "S" })).rejects.toThrow(/Role must be/);
  });

  it("sign-up can never make an admin", async () => {
    const email = `sneaky.${Date.now()}@example.com`;
    const res = await request(app)
      .post("/api/v1/auth/register")
      .send({ name: "Sneaky", email, password: TEST_PASSWORD, adultConfirmed: true, consent: true, role: "admin" });
    // The extra "role" field is dropped; the account is a parent.
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe("parent");
    expect((await User.findOne({ email }).lean())?.role).toBe("parent");
  });

  it("changes a role (one audit entry) and logs the person out everywhere", async () => {
    const user = await makeUser("parent");
    await request(app).post("/api/v1/auth/login").send({ email: user.email, password: TEST_PASSWORD });
    expect(await Session.countDocuments({ userId: user.id })).toBe(1);

    const entries = await auditDuring(() => setRole(user.email, "facilitator"));
    expect(entries.map((e) => e.action)).toEqual(["user.role_change"]);
    expect(await Session.countDocuments({ userId: user.id })).toBe(0);
    // The old parent wristband stops working: the role in it no longer matches.
    expect((await request(app).get("/api/v1/auth/me").set(bearer(user.token))).status).toBe(401);

    // Same role again: nothing changes, nothing logged.
    expect(await auditDuring(() => setRole(user.email, "facilitator"))).toHaveLength(0);
  });

  it("links and unlinks a facilitator to a child, one audit entry each", async () => {
    const parent = await makeUser("parent");
    const alex = await makeChild(parent.id);
    const teacher = await makeUser("facilitator");

    const linked = await auditDuring(() => linkFacilitator(teacher.email, alex));
    expect(linked.map((e) => e.action)).toEqual(["facilitator.link"]);
    expect(await FacilitatorLink.countDocuments({ facilitatorId: teacher.id, childId: alex })).toBe(1);
    // Linking twice is harmless.
    expect(await auditDuring(() => linkFacilitator(teacher.email, alex))).toHaveLength(0);

    const unlinked = await auditDuring(() => unlinkFacilitator(teacher.email, alex));
    expect(unlinked.map((e) => e.action)).toEqual(["facilitator.unlink"]);
    expect(await FacilitatorLink.countDocuments({ facilitatorId: teacher.id })).toBe(0);

    await expect(linkFacilitator(parent.email, alex)).rejects.toThrow(/not a facilitator/);
    await expect(linkFacilitator(teacher.email, "abc")).rejects.toThrow(/No child/);
  });
});

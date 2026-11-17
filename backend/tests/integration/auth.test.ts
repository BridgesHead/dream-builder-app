// BE-03: parent accounts and verifiable consent, against a real (test) MongoDB.
import express, { type Express } from "express";
import { SignJWT } from "jose";
import mongoose from "mongoose";
import request from "supertest";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, Consent, EmailLink, Session, User } from "../../src/db/models/index.js";
import { logger } from "../../src/lib/logger.js";
import { hashToken } from "../../src/lib/randomToken.js";
import { errorHandler } from "../../src/middleware/errorHandler.js";
import { allow } from "../../src/middleware/access.js";
import { createAccessToken } from "../../src/services/accessTokens.js";
import { outbox } from "../../src/services/email.js";

const API = "/api/v1/auth";
const GOOD_PASSWORD = "Rocket123";

let app: Express;
let counter = 0;
const newEmail = () => `parent${++counter}.${Date.now()}@example.com`;

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await disconnectFromDatabase();
});

// A fresh app per test = fresh rate-limit counts, so tests don't block each other.
beforeEach(() => {
  app = createApp();
});

async function register(agent: ReturnType<typeof request.agent>, overrides: Record<string, unknown> = {}) {
  const email = newEmail();
  const res = await agent
    .post(`${API}/register`)
    .send({ name: "Sarah Jenkins", email, password: GOOD_PASSWORD, adultConfirmed: true, consent: true, ...overrides });
  return { res, email };
}

// The token from the newest email sent to this address.
function linkTokenFor(email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === email);
  if (!mail) throw new Error(`no email sent to ${email}`);
  return decodeURIComponent(/token=([^\s]+)/.exec(mail.text)![1]);
}

function refreshCookieFrom(res: request.Response): string {
  const cookies = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = cookies.find((c) => c.startsWith("db_refresh="));
  if (!cookie) throw new Error("no refresh cookie");
  return cookie;
}

describe("register", () => {
  it("creates the parent, records consent, logs them in and emails a verification link", async () => {
    const agent = request.agent(app);
    const { res, email } = await register(agent);

    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email, name: "Sarah Jenkins", role: "parent", emailVerified: false });
    expect(typeof res.body.accessToken).toBe("string");

    // The refresh token is in a safe cookie, never in the body.
    const cookie = refreshCookieFrom(res);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);

    // Consent: who, when, IP, text version and method.
    const consent = await Consent.findOne({ parentId: res.body.user.id }).lean();
    expect(consent).toMatchObject({ textVersion: config.consentTextVersion, method: "email_verification" });
    expect(consent?.ipAddress).toBeTruthy();
    expect(consent?.createdAt).toBeInstanceOf(Date);

    expect(linkTokenFor(email)).toBeTruthy();
  });

  it("existing email → 409 EMAIL_TAKEN (whatever the letter case)", async () => {
    const { email } = await register(request.agent(app));
    const res = await request(app)
      .post(`${API}/register`)
      .send({ name: "Other", email: email.toUpperCase(), password: GOOD_PASSWORD, adultConfirmed: true, consent: true });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("EMAIL_TAKEN");
  });

  it("weak password → 400 WEAK_PASSWORD, and no account is made", async () => {
    const { res, email } = await register(request.agent(app), { password: "short" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEAK_PASSWORD");
    expect(res.body.error.fields.password.length).toBeGreaterThan(0);
    expect(await User.exists({ email })).toBeNull();
  });

  it.each([{ consent: false }, { adultConfirmed: false }])("missing consent %o → 400 CONSENT_REQUIRED", async (overrides) => {
    const { res, email } = await register(request.agent(app), overrides);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
    expect(await User.exists({ email })).toBeNull();
  });
});

describe("login, refresh, logout", () => {
  it("wrong password and unknown email both → 401 INVALID_CREDENTIALS", async () => {
    const { email } = await register(request.agent(app));
    const wrong = await request(app).post(`${API}/login`).send({ email, password: "Wrong1234" });
    const unknown = await request(app).post(`${API}/login`).send({ email: "nobody@example.com", password: GOOD_PASSWORD });
    for (const res of [wrong, unknown]) {
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe("INVALID_CREDENTIALS");
    }
    expect(wrong.body).toEqual(unknown.body); // identical answers reveal nothing
  });

  it("'remember me' keeps the cookie 30 days; without it, until the browser closes", async () => {
    const { email } = await register(request.agent(app));
    const remembered = await request(app).post(`${API}/login`).send({ email, password: GOOD_PASSWORD, remember: true });
    const notRemembered = await request(app).post(`${API}/login`).send({ email, password: GOOD_PASSWORD });
    expect(remembered.status).toBe(200);
    expect(refreshCookieFrom(remembered)).toMatch(/Max-Age=2592000/);
    expect(refreshCookieFrom(notRemembered)).not.toMatch(/Max-Age|Expires/i);
  });

  it("refresh gives a new access token; after logout it doesn't", async () => {
    const agent = request.agent(app);
    await register(agent);

    const refreshed = await agent.post(`${API}/refresh`);
    expect(refreshed.status).toBe(200);
    expect(typeof refreshed.body.accessToken).toBe("string");

    const me = await agent.get(`${API}/me`).set("Authorization", `Bearer ${refreshed.body.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.user.role).toBe("parent");

    expect((await agent.post(`${API}/logout`)).status).toBe(204);
    const after = await agent.post(`${API}/refresh`);
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("expired session → 401 SESSION_EXPIRED (both the access token and the refresh token)", async () => {
    const agent = request.agent(app);
    const { res } = await register(agent);
    const userId = res.body.user.id as string;

    // An access token that ran out a minute ago, signed with the real key.
    const expired = await new SignJWT({ role: "parent" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject(userId)
      .setIssuer("dream-builder-api")
      .setAudience("dream-builder")
      .setExpirationTime(Math.floor(Date.now() / 1000) - 60)
      .sign(new TextEncoder().encode(config.jwtAccessSecret));
    const me = await request(app).get(`${API}/me`).set("Authorization", `Bearer ${expired}`);
    expect(me.status).toBe(401);
    expect(me.body.error.code).toBe("SESSION_EXPIRED");

    // A refresh token whose session ran out.
    await Session.updateMany({ userId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const refresh = await agent.post(`${API}/refresh`);
    expect(refresh.status).toBe(401);
    expect(refresh.body.error.code).toBe("SESSION_EXPIRED");
  });

  it("no token or a rubbish token → 401 UNAUTHENTICATED", async () => {
    expect((await request(app).get(`${API}/me`)).body.error.code).toBe("UNAUTHENTICATED");
    expect((await request(app).get(`${API}/me`).set("Authorization", "Bearer nope")).body.error.code).toBe("UNAUTHENTICATED");
  });
});

describe("rate limit on login", () => {
  it("10 failed logins in 15 minutes block further tries, even with the right password", async () => {
    const { email } = await register(request.agent(app));
    for (let i = 0; i < 10; i++) {
      const res = await request(app).post(`${API}/login`).send({ email, password: "Wrong1234" });
      expect(res.status).toBe(401);
    }
    const blocked = await request(app).post(`${API}/login`).send({ email, password: GOOD_PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe("TOO_MANY_ATTEMPTS");

    // Another parent's account is not affected.
    const other = await register(request.agent(app));
    expect((await request(app).post(`${API}/login`).send({ email: other.email, password: GOOD_PASSWORD })).status).toBe(200);
  });
});

describe("email verification link", () => {
  it("works once, then fails with LINK_USED", async () => {
    const agent = request.agent(app);
    const { res, email } = await register(agent);
    const token = linkTokenFor(email);

    expect((await request(app).post(`${API}/verify-email`).send({ token })).status).toBe(204);
    const me = await agent.get(`${API}/me`).set("Authorization", `Bearer ${res.body.accessToken}`);
    expect(me.body.user.emailVerified).toBe(true);

    const again = await request(app).post(`${API}/verify-email`).send({ token });
    expect(again.status).toBe(400);
    expect(again.body.error.code).toBe("LINK_USED");
  });

  it("fails with LINK_EXPIRED after 24 hours", async () => {
    const { email } = await register(request.agent(app));
    const token = linkTokenFor(email);
    // Pretend the 24 hours have passed.
    await EmailLink.updateOne({ tokenHash: hashToken(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post(`${API}/verify-email`).send({ token });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LINK_EXPIRED");
  });

  it("an unknown token fails with LINK_INVALID", async () => {
    const res = await request(app).post(`${API}/verify-email`).send({ token: "made-up-token" });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("LINK_INVALID");
  });

  it("resending makes the older link stop working", async () => {
    const agent = request.agent(app);
    const { res, email } = await register(agent);
    const oldToken = linkTokenFor(email);
    await agent.post(`${API}/resend-verification`).set("Authorization", `Bearer ${res.body.accessToken}`).expect(204);
    const newToken = linkTokenFor(email);

    expect(newToken).not.toBe(oldToken);
    expect((await request(app).post(`${API}/verify-email`).send({ token: oldToken })).body.error.code).toBe("LINK_USED");
    expect((await request(app).post(`${API}/verify-email`).send({ token: newToken })).status).toBe(204);
  });
});

describe("forgot and reset password", () => {
  it("gives the same answer for unknown emails, and sends no email", async () => {
    const before = outbox.length;
    const res = await request(app).post(`${API}/forgot-password`).send({ email: "nobody@example.com" });
    expect(res.status).toBe(204);
    expect(outbox.length).toBe(before);
  });

  it("resets the password once, logs out every device, and the link then fails", async () => {
    const agent = request.agent(app);
    const { email } = await register(agent);
    await request(app).post(`${API}/forgot-password`).send({ email }).expect(204);
    const token = linkTokenFor(email);

    // A weak new password is refused, and does NOT use up the link.
    const weak = await request(app).post(`${API}/reset-password`).send({ token, password: "weak" });
    expect(weak.body.error.code).toBe("WEAK_PASSWORD");

    expect((await request(app).post(`${API}/reset-password`).send({ token, password: "NewRocket456" })).status).toBe(204);

    // Logged out everywhere: the old refresh cookie no longer works.
    expect((await agent.post(`${API}/refresh`)).status).toBe(401);
    // Old password fails, new one works.
    expect((await request(app).post(`${API}/login`).send({ email, password: GOOD_PASSWORD })).status).toBe(401);
    expect((await request(app).post(`${API}/login`).send({ email, password: "NewRocket456" })).status).toBe(200);

    const again = await request(app).post(`${API}/reset-password`).send({ token, password: "Another789" });
    expect(again.body.error.code).toBe("LINK_USED");
  });

  it("the reset link fails with LINK_EXPIRED after 24 hours", async () => {
    const { email } = await register(request.agent(app));
    await request(app).post(`${API}/forgot-password`).send({ email }).expect(204);
    const token = linkTokenFor(email);
    await EmailLink.updateOne({ tokenHash: hashToken(token) }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

    const res = await request(app).post(`${API}/reset-password`).send({ token, password: "NewRocket456" });
    expect(res.body.error.code).toBe("LINK_EXPIRED");
  });
});

describe("a parent can't create child profiles until email is verified AND consent is recorded", () => {
  // A tiny app with one route behind the same guard BE-04's "create child" route will use.
  const guarded = express();
  guarded.get("/create-child", allow("verified_parent"), (_req: express.Request, res: express.Response) => {
    res.json({ ok: true });
    return;
  });
  guarded.use(errorHandler);

  it("not verified → 403 EMAIL_NOT_VERIFIED; verified → allowed", async () => {
    const { res, email } = await register(request.agent(app));
    const auth = `Bearer ${res.body.accessToken}`;

    const before = await request(guarded).get("/create-child").set("Authorization", auth);
    expect(before.status).toBe(403);
    expect(before.body.error.code).toBe("EMAIL_NOT_VERIFIED");

    await request(app).post(`${API}/verify-email`).send({ token: linkTokenFor(email) }).expect(204);
    expect((await request(guarded).get("/create-child").set("Authorization", auth)).status).toBe(200);
  });

  it("verified but no consent record → 403 CONSENT_REQUIRED", async () => {
    // Made directly, skipping register, so there is no consent record.
    const user = await User.create({ email: newEmail(), name: "No Consent", passwordHash: "x", emailVerifiedAt: new Date() });
    const token = await createAccessToken(String(user._id), "parent");

    const res = await request(guarded).get("/create-child").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("CONSENT_REQUIRED");
  });
});

describe("passwords and tokens never appear in logs or API responses", () => {
  const captured: string[] = [];

  beforeEach(() => {
    captured.length = 0;
    // Record everything sent to the logger and the console during the test.
    for (const level of ["trace", "debug", "info", "warn", "error", "fatal"] as const) {
      vi.spyOn(logger, level).mockImplementation(((...args: unknown[]) => {
        captured.push(JSON.stringify(args));
      }) as never);
    }
    for (const method of ["log", "info", "warn", "error"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        captured.push(JSON.stringify(args));
      });
    }
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("through a whole journey: register, verify, login, refresh, forgot, reset, logout", async () => {
    const agent = request.agent(app);
    const bodies: string[] = [];
    const keep = (res: request.Response) => {
      bodies.push(JSON.stringify(res.body));
      return res;
    };

    const { res: reg, email } = await register(agent);
    keep(reg);
    const refreshToken = decodeURIComponent(refreshCookieFrom(reg).split(";")[0].split("=")[1]);
    const verifyToken = linkTokenFor(email);
    keep(await request(app).post(`${API}/verify-email`).send({ token: verifyToken }));
    keep(await request(app).post(`${API}/login`).send({ email, password: "Wrong1234" }));
    keep(await agent.post(`${API}/login`).send({ email, password: GOOD_PASSWORD }));
    keep(await agent.post(`${API}/refresh`));
    keep(await request(app).post(`${API}/forgot-password`).send({ email }));
    const resetToken = linkTokenFor(email);
    keep(await request(app).post(`${API}/reset-password`).send({ token: resetToken, password: "NewRocket456" }));
    keep(await agent.post(`${API}/logout`));

    const hash = (await User.findOne({ email }).select("+passwordHash").lean())!.passwordHash;
    const secrets = { GOOD_PASSWORD, newPassword: "NewRocket456", refreshToken, verifyToken, resetToken, hash };

    expect(captured.length).toBeGreaterThan(0); // the logger really was recording
    const logs = captured.join("\n");
    const responses = bodies.join("\n");
    for (const [name, secret] of Object.entries(secrets)) {
      expect(logs, `${name} found in logs`).not.toContain(secret);
      expect(responses, `${name} found in a response`).not.toContain(secret);
    }
    expect(responses).not.toContain("passwordHash");
  });
});

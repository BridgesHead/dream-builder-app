// Test helpers: make one caller of each kind, straight in the database, with a ready token.
import { Child, Consent, FacilitatorLink, Session, Story, User, type UserRole } from "../../src/db/models/index.js";
import { hashPassword } from "../../src/lib/password.js";
import { createRandomToken, hashToken } from "../../src/lib/randomToken.js";
import { createAccessToken, createChildAccessToken } from "../../src/services/accessTokens.js";

export const TEST_PASSWORD = "Rocket123";
let counter = 0;

export async function makeUser(role: UserRole, options: { verified?: boolean; consent?: boolean } = {}) {
  const email = `${role}${++counter}.${Date.now()}@example.com`;
  const user = await User.create({
    email,
    name: `Test ${role}`,
    passwordHash: await hashPassword(TEST_PASSWORD),
    role,
    emailVerifiedAt: options.verified === false ? null : new Date(),
  });
  if (role === "parent" && options.consent !== false) {
    await Consent.create({ parentId: user._id, textVersion: "test-v1", method: "email_verification", ipAddress: "127.0.0.1" });
  }
  return { id: String(user._id), email, token: await createAccessToken(String(user._id), role) };
}

export async function makeChild(parentId: string, name = "Alex", age = 8) {
  const child = await Child.create({ parentId, name, age, language: "English" });
  return String(child._id);
}

export async function makeStory(childId: string, title = "Pip and the Dragon") {
  const child = await Child.findById(childId).lean();
  const story = await Story.create({ childId, mode: child!.mode, title });
  return String(story._id);
}

// An open child session for this child, and its kids' wristband.
export async function makeChildSession(parentId: string, childId: string) {
  const session = await Session.create({
    userId: parentId,
    childId,
    tokenHash: hashToken(createRandomToken()),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    remember: false,
  });
  return createChildAccessToken(parentId, childId, String(session._id));
}

export async function linkToChild(facilitatorId: string, childId: string) {
  await FacilitatorLink.create({ facilitatorId, childId });
}

export const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

import { isValidObjectId } from "mongoose";
import { Child, FacilitatorLink, User, USER_ROLES, type UserRole } from "../db/models/index.js";
import { createRandomToken } from "../lib/randomToken.js";
import { hashPassword } from "../lib/password.js";
import { writeAudit } from "./audit.js";
import { forgotPassword } from "./auth.js";
import { endAllSessions } from "./sessions.js";

// Staff tools (guide BE-05), used ONLY by the command-line script scripts/users.ts, never by
// an API route. That is how "admins are created only by a script, never through sign-up" holds.
// Every change writes an audit entry with actorRole "system".

const EMAIL_SHAPE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
function cleanEmail(email: string): string {
  const e = email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(e)) throw new Error(`"${email}" is not an email address`);
  return e;
}

function assertRole(role: string): asserts role is UserRole {
  if (!(USER_ROLES as readonly string[]).includes(role)) throw new Error(`Role must be one of: ${USER_ROLES.join(", ")}`);
}

// Makes an admin or facilitator. Nobody knows the starting password (it's random and never
// shown); the new person gets a "set your password" email (the reset link) instead.
export async function createStaffUser(input: { email: string; name: string; role: string }) {
  assertRole(input.role);
  if (input.role === "parent") throw new Error("Parents sign up in the app; this script makes admins and facilitators");
  const email = cleanEmail(input.email);
  if (await User.exists({ email })) throw new Error(`${email} already has an account (use set-role to change its role)`);

  const user = await User.create({
    email,
    name: input.name.trim(),
    passwordHash: await hashPassword(createRandomToken()),
    role: input.role,
    emailVerifiedAt: new Date(),
  });
  await writeAudit({ actorId: null, actorRole: "system", action: "user.create", targetType: "user", targetId: String(user._id) });
  await forgotPassword(email);
  return { id: String(user._id), email, role: input.role };
}

// Changes someone's role. They are logged out everywhere, so their next login carries the new role.
export async function setRole(emailInput: string, role: string) {
  assertRole(role);
  const email = cleanEmail(emailInput);
  const user = await User.findOne({ email });
  if (!user) throw new Error(`No account for ${email}`);
  if (user.role === role) return { id: String(user._id), email, role, changed: false };

  user.role = role;
  await user.save();
  await endAllSessions(user._id);
  await writeAudit({ actorId: null, actorRole: "system", action: "user.role_change", targetType: "user", targetId: String(user._id) });
  return { id: String(user._id), email, role, changed: true };
}

async function facilitatorAndChild(facilitatorEmail: string, childId: string) {
  const email = cleanEmail(facilitatorEmail);
  const facilitator = await User.findOne({ email });
  if (!facilitator || facilitator.role !== "facilitator") throw new Error(`${email} is not a facilitator`);
  if (!isValidObjectId(childId) || !(await Child.exists({ _id: childId, deletedAt: null }))) {
    throw new Error(`No child with id ${childId}`);
  }
  return facilitator;
}

// "This facilitator may read this child's stories."
export async function linkFacilitator(facilitatorEmail: string, childId: string) {
  const facilitator = await facilitatorAndChild(facilitatorEmail, childId);
  const existing = await FacilitatorLink.findOne({ facilitatorId: facilitator._id, childId });
  if (existing) return { id: String(existing._id), created: false };

  const link = await FacilitatorLink.create({ facilitatorId: facilitator._id, childId });
  await writeAudit({ actorId: null, actorRole: "system", action: "facilitator.link", targetType: "facilitator_link", targetId: String(link._id) });
  return { id: String(link._id), created: true };
}

export async function unlinkFacilitator(facilitatorEmail: string, childId: string) {
  const facilitator = await facilitatorAndChild(facilitatorEmail, childId);
  const link = await FacilitatorLink.findOneAndDelete({ facilitatorId: facilitator._id, childId });
  if (!link) return { removed: false };
  await writeAudit({ actorId: null, actorRole: "system", action: "facilitator.unlink", targetType: "facilitator_link", targetId: String(link._id) });
  return { removed: true };
}

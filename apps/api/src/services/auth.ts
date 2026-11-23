import { config } from "../config.js";
import { Consent, User } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { DUMMY_PASSWORD_HASH, hashPassword, passwordProblems, verifyPassword } from "../lib/password.js";
import { writeAudit } from "./audit.js";
import { passwordResetEmail, sendEmail, verificationEmail } from "./email.js";
import { createEmailLink, useEmailLink } from "./emailLinks.js";
import { endAllSessions } from "./sessions.js";
import { toPublicUser, type PublicUser } from "./users.js";

// The account logic (guide BE-03). Routes stay thin: they check the request's shape, call
// one of these, and send the answer. Nothing here knows about HTTP requests or cookies.

function assertStrongPassword(password: string): void {
  const problems = passwordProblems(password);
  if (problems.length > 0) {
    throw new AppError(400, "WEAK_PASSWORD", "Please choose a stronger password", { password: problems });
  }
}

// MongoDB's error code for "this unique value is already taken".
const DUPLICATE_KEY = 11000;

export interface RegisterInput {
  name: string;
  email: string; // already trimmed and lowercased by the route's Zod schema
  password: string;
  adultConfirmed: boolean; // "I am at least 18 and allowed to supervise the child"
  consent: boolean; // "I give verified parental consent"
}

// Creates the parent, records their consent, and emails the verification link.
export async function register(input: RegisterInput, ipAddress: string): Promise<PublicUser> {
  if (!input.adultConfirmed || !input.consent) {
    throw new AppError(400, "CONSENT_REQUIRED", "Please confirm you are 18 or over and give parental consent", {
      ...(!input.adultConfirmed && { adultConfirmed: ["Required"] }),
      ...(!input.consent && { consent: ["Required"] }),
    });
  }
  assertStrongPassword(input.password);

  const taken = () => new AppError(409, "EMAIL_TAKEN", "An account with this email already exists");
  if (await User.exists({ email: input.email })) throw taken();

  let user;
  try {
    user = await User.create({
      name: input.name,
      email: input.email,
      passwordHash: await hashPassword(input.password),
      role: "parent",
    });
  } catch (err) {
    // Two sign-ups with the same email at the same moment: the unique index stops the second.
    if ((err as { code?: number }).code === DUPLICATE_KEY) throw taken();
    throw err;
  }

  // The consent record: who, when (createdAt), IP address, text version and method.
  let consent;
  try {
    consent = await Consent.create({
      parentId: user._id,
      textVersion: config.consentTextVersion,
      method: "email_verification",
      ipAddress,
    });
  } catch (err) {
    // No consent record means no account: remove the half-made account and give up.
    await User.deleteOne({ _id: user._id });
    throw err;
  }

  // BE-05: one audit entry for the consent (register is a sign-up, not a sign-in).
  await writeAudit({ actorId: String(user._id), actorRole: "parent", action: "consent.record", targetType: "consent", targetId: String(consent._id), ipAddress });

  const token = await createEmailLink(user._id, "verify_email");
  await sendEmail(verificationEmail(user.email, user.name, token));

  return toPublicUser(user);
}

// Checks email + password. Wrong password and unknown email get the SAME answer, and take
// the same time, so this can't be used to find out who has an account.
export async function login(email: string, password: string, ipAddress?: string): Promise<PublicUser> {
  const user = await User.findOne({ email }).select("+passwordHash");
  const ok = await verifyPassword(user?.passwordHash ?? DUMMY_PASSWORD_HASH, password);
  if (!user || !ok) throw new AppError(401, "INVALID_CREDENTIALS", "The email or password is not right");
  // BE-05: every successful sign-in, by any role.
  await writeAudit({ actorId: String(user._id), actorRole: user.role, action: "auth.sign_in", targetType: "user", targetId: String(user._id), ipAddress });
  return toPublicUser(user);
}

// The parent clicked the link in the verification email.
export async function verifyEmail(token: string): Promise<void> {
  const userId = await useEmailLink(token, "verify_email");
  // Only set it the first time, so the date shows when they first verified.
  await User.updateOne({ _id: userId, emailVerifiedAt: null }, { $set: { emailVerifiedAt: new Date() } });
}

export async function resendVerification(userId: string): Promise<void> {
  const user = await User.findById(userId);
  if (!user || user.emailVerifiedAt) return; // already verified: nothing to do
  const token = await createEmailLink(user._id, "verify_email");
  await sendEmail(verificationEmail(user.email, user.name, token));
}

// Always "succeeds", whether or not the email has an account, so the answer reveals nothing.
export async function forgotPassword(email: string): Promise<void> {
  const user = await User.findOne({ email });
  if (!user) return;
  const token = await createEmailLink(user._id, "reset_password");
  await sendEmail(passwordResetEmail(user.email, user.name, token));
}

export async function resetPassword(token: string, newPassword: string): Promise<void> {
  // Check the new password BEFORE using the link, so a weak password doesn't waste the link.
  assertStrongPassword(newPassword);
  const userId = await useEmailLink(token, "reset_password");
  await User.updateOne({ _id: userId }, { $set: { passwordHash: await hashPassword(newPassword) } });
  // Log out every device: if someone else was logged in with the old password, they're out.
  await endAllSessions(userId);
}

// The account calls to the Dream Builder API (backend BE-03). Screens use these instead of
// calling api() directly, so the access token is always stored and cleared in one place.
import { api, refreshAccessToken, setAccessToken } from "./api";
import type { ServerChild } from "./children";

/** The parent as the server describes them. */
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: "parent" | "facilitator" | "admin";
  emailVerified: boolean;
}

interface SessionResponse {
  user: AuthUser;
  accessToken: string;
}

export async function register(input: {
  name: string;
  email: string;
  password: string;
  adultConfirmed: boolean;
  consent: boolean;
}): Promise<AuthUser> {
  const res = await api<SessionResponse>("/auth/register", { method: "POST", body: input });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function login(email: string, password: string, remember: boolean): Promise<AuthUser> {
  const res = await api<SessionResponse>("/auth/login", { method: "POST", body: { email, password, remember } });
  setAccessToken(res.accessToken);
  return res.user;
}

export async function logout(): Promise<void> {
  try {
    await api("/auth/logout", { method: "POST" });
  } finally {
    // Forget the access token even if the server couldn't be reached.
    setAccessToken(null);
  }
}

/** Who holds this device, as the server sees it. */
export type DeviceSession = { kind: "parent"; user: AuthUser } | { kind: "child"; child: ServerChild };

/**
 * Called when the app opens: is anyone still logged in on this device (valid refresh cookie)?
 * Returns the parent or, after a handover, the child; null if nobody; "offline" if the
 * server can't be reached.
 */
export async function restoreSession(): Promise<DeviceSession | null | "offline"> {
  try {
    const res = await refreshAccessToken();
    if (!res) return null;
    return res.kind === "child" ? { kind: "child", child: res.child as ServerChild } : { kind: "parent", user: res.user as AuthUser };
  } catch {
    return "offline";
  }
}

// ---- Handing the device to a child, and back (backend BE-04) ----

/**
 * The parent hands the device to a child. The parent's session on this device ends and a
 * child session starts: from now on the API only lets this child reach their own stories.
 */
export async function startChildSession(childId: string): Promise<ServerChild> {
  const res = await api<{ child: ServerChild; accessToken: string }>("/auth/child-session", { method: "POST", body: { childId } });
  setAccessToken(res.accessToken);
  return res.child;
}

/** A grown-up types the parent's password to leave the child session. */
export async function exitChildSession(password: string): Promise<AuthUser> {
  const res = await api<SessionResponse>("/auth/child-session/exit", { method: "POST", body: { password } });
  setAccessToken(res.accessToken);
  return res.user;
}

export function verifyEmail(token: string): Promise<void> {
  return api("/auth/verify-email", { method: "POST", body: { token } });
}

export function resendVerification(): Promise<void> {
  return api("/auth/resend-verification", { method: "POST" });
}

export function forgotPassword(email: string): Promise<void> {
  return api("/auth/forgot-password", { method: "POST", body: { email } });
}

export function resetPassword(token: string, password: string): Promise<void> {
  return api("/auth/reset-password", { method: "POST", body: { token, password } });
}

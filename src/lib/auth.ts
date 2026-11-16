// The account calls to the Dream Builder API (backend BE-03). Screens use these instead of
// calling api() directly, so the access token is always stored and cleared in one place.
import { api, refreshAccessToken, setAccessToken } from "./api";

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

/**
 * Called when the app opens: is the parent still logged in (valid refresh cookie)?
 * Returns the user, null if not logged in, or "offline" if the server can't be reached.
 */
export async function restoreSession(): Promise<AuthUser | null | "offline"> {
  try {
    const res = await refreshAccessToken();
    return res ? (res.user as AuthUser) : null;
  } catch {
    return "offline";
  }
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

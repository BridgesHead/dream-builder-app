// Small helper for calling the Dream Builder API.
//
//   const { user } = await api<{ user: AuthUser }>("/auth/me");
//
// - Adds the /api/v1 prefix (Vite's dev proxy forwards /api to the backend).
// - Sends and parses JSON.
// - Sends the access token (kept in memory, never in localStorage) as "Authorization: Bearer ...".
// - When the access token has expired, or isn't there yet because the page was just
//   reloaded, quietly gets a new one with the refresh cookie and tries the request once more.
// - Throws ApiError with the server's code and message when the response isn't ok.

const BASE = "/api/v1";

export class ApiError extends Error {
  readonly status: number;
  /** Stable error code from the server, e.g. "EMAIL_TAKEN". Safe to check in code. */
  readonly code: string;
  /** Per-field problems from the server, e.g. { password: ["Use at least 8 characters"] }. */
  readonly fields: Record<string, string[]>;

  constructor(message: string, status: number, code = "UNKNOWN", fields: Record<string, string[]> = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// The 15-minute access token. Only in memory: a page reload forgets it, and the refresh
// cookie (which page JavaScript can't read) gets a new one.
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

type Method = "GET" | "POST" | "PATCH" | "DELETE";

interface ApiOptions {
  method?: Method;
  body?: unknown;
  signal?: AbortSignal;
}

async function send(path: string, { method = "GET", body, signal }: ApiOptions): Promise<Response> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(BASE + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    // Aborted on purpose (e.g. the screen unmounted): let the caller ignore it.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    // fetch only throws when there's no response at all: offline, server down, etc.
    throw new ApiError("Can't reach the server. Check your connection and try again.", 0, "NETWORK");
  }
}

async function toError(res: Response): Promise<ApiError> {
  // Not every response is JSON (e.g. the dev proxy's error page when the backend is off).
  const data = (await res.json().catch(() => null)) as {
    error?: { code?: unknown; message?: unknown; fields?: unknown };
  } | null;
  const err = data?.error;
  const message =
    typeof err?.message === "string"
      ? err.message
      : res.status >= 500
        ? "Something went wrong on our side. Please try again."
        : `Request failed (${res.status})`;
  const code = typeof err?.code === "string" ? err.code : "UNKNOWN";
  const fields = err?.fields && typeof err.fields === "object" ? (err.fields as Record<string, string[]>) : {};
  return new ApiError(message, res.status, code, fields);
}

type RefreshResult = { kind: "parent"; user: unknown } | { kind: "child"; child: unknown } | null;

// Everyone who needs a new token at the same moment (the app opening, and the first screen's
// requests that went out before it had one) shares ONE refresh call.
let refreshing: Promise<RefreshResult> | null = null;

/**
 * Gets a new access token using the refresh cookie.
 * Returns who holds this device if still logged in: { kind: "parent", user } or, after a
 * handover, { kind: "child", child }. null if not (no cookie, or the session ended).
 * Throws ApiError if the server can't be reached or is broken, so a server outage is never
 * mistaken for "logged out".
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  refreshing ??= refreshOnce().finally(() => (refreshing = null));
  return refreshing;
}

async function refreshOnce(): Promise<RefreshResult> {
  const res = await send("/auth/refresh", { method: "POST" });
  if (res.status >= 500) throw await toError(res);
  if (!res.ok) {
    accessToken = null;
    return null;
  }
  const data = (await res.json()) as { kind?: string; user?: unknown; child?: unknown; accessToken: string };
  accessToken = data.accessToken;
  return data.kind === "child" ? { kind: "child", child: data.child } : { kind: "parent", user: data.user };
}

export async function api<T = unknown>(path: string, options: ApiOptions = {}): Promise<T> {
  const hadToken = accessToken !== null;
  let res = await send(path, options);

  // No token yet (the page was just reloaded: a screen can ask before the app has restored
  // the session) or it ran out: refresh once, then try again. Not for the auth routes
  // themselves, where a 401 means a wrong password or a dead session.
  if (res.status === 401 && !path.startsWith("/auth/")) {
    const expired = (await res.clone().json().catch(() => null))?.error?.code === "SESSION_EXPIRED";
    if (!hadToken || expired) {
      const stillLoggedIn = await refreshAccessToken()
        .then((r) => r !== null)
        .catch(() => false);
      if (stillLoggedIn) res = await send(path, options);
    }
  }

  // 204 No Content (logout, verify, ...): nothing to parse.
  if (res.status === 204) return undefined as T;
  if (!res.ok) throw await toError(res);
  return (await res.json()) as T;
}

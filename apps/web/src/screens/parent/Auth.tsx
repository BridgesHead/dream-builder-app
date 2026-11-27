import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useLocation, useSearch } from "wouter";
import { Apple, Eye, EyeOff, Github } from "lucide-react";
import { AppShell, CenteredCard } from "@/components/Layout";
import { Arrow, Button, Card, CheckRow, Field, LinkButton } from "@/components/ui";
import { useAppState } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import * as auth from "@/lib/auth";
import { ROUTES } from "@/lib/routes";

function PasswordField({
  value,
  onChange,
  onEnter,
  label = "Password",
}: {
  value: string;
  onChange: (v: string) => void;
  onEnter?: () => void;
  label?: string;
}) {
  const [show, setShow] = useState(false);
  return (
    <Field
      id="password"
      label={label}
      type={show ? "text" : "password"}
      placeholder="•••••••"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onEnter={onEnter}
      trailing={
        <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"}>
          {show ? <EyeOff className="h-4 w-4 text-ink-muted" /> : <Eye className="h-4 w-4 text-ink-muted" />}
        </button>
      }
    />
  );
}

const GoogleMark = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden>
    <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.4h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.2-2.1 3.5-5.1 3.5-8.7z" />
    <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
    <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6H1.3a12 12 0 0 0 0 10.8l4-3.1z" />
    <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
  </svg>
);

const PROVIDERS = [
  { name: "Google", mark: <GoogleMark /> },
  { name: "Apple", mark: <Apple className="h-4 w-4 fill-ink text-ink" aria-hidden /> },
  { name: "GitHub", mark: <Github className="h-4 w-4 text-ink" aria-hidden /> },
];

function SocialRow({ label }: { label: string }) {
  // Visual only: social sign-in is a known gap (backend README, "Known gaps").
  return (
    <>
      <div className="my-5 flex items-center gap-3 text-xs text-ink-muted">
        <span className="h-px flex-1 bg-ink/10" />
        {label}
        <span className="h-px flex-1 bg-ink/10" />
      </div>
      <div className="flex justify-center gap-3">
        {PROVIDERS.map((p) => (
          <button
            key={p.name}
            type="button"
            aria-label={`Continue with ${p.name}`}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-ink/15 bg-white hover:bg-tile"
          >
            {p.mark}
          </button>
        ))}
      </div>
    </>
  );
}

function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <AppShell plainLogo>
      <CenteredCard>
        <Card className="w-full">
          <h1 className="mb-6 text-center font-display text-[26px] font-bold text-ink">{title}</h1>
          {children}
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

/** Turns anything thrown into an ApiError, so screens only handle one kind of error. */
function asApiError(err: unknown): ApiError {
  return err instanceof ApiError ? err : new ApiError("Something went wrong. Please try again.", 0);
}

/** The server's message, plus any per-field problems (e.g. what's wrong with the password). */
function ErrorNote({ error }: { error: ApiError | null }) {
  if (!error) return null;
  const details = Object.values(error.fields).flat();
  return (
    <div role="alert" className="mb-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
      <p className="font-semibold">{error.message}</p>
      {details.length > 0 && (
        <ul className="mt-1 list-disc pl-5 text-xs">
          {details.map((d) => (
            <li key={d}>{d}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Notice({ children }: { children: ReactNode }) {
  return <div className="mb-4 rounded-xl bg-brand-soft px-3 py-3 text-sm text-ink">{children}</div>;
}

/** Runs an async action with a busy flag and an error, for submit buttons. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(asApiError(err));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

export function SignupScreen() {
  const [, navigate] = useLocation();
  const { updateParent } = useAppState();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isAdult, setIsAdult] = useState(false);
  const [consent, setConsent] = useState(false);
  const { busy, error, run } = useAction();

  const canSubmit = name.trim() && email.includes("@") && password.length >= 8 && isAdult && consent && !busy;
  const submit = () => {
    if (!canSubmit) return;
    void run(async () => {
      const user = await auth.register({ name: name.trim(), email, password, adultConfirmed: isAdult, consent });
      updateParent({ holder: "parent", account: { name: user.name, email: user.email, emailVerified: user.emailVerified } });
      // Next: "check your inbox", then child setup.
      navigate(ROUTES.verifyEmail);
    });
  };

  return (
    <AuthFrame title="Create your account">
      <ErrorNote error={error} />
      <Field id="name" label="Full Name" placeholder="Enter your name" value={name} onChange={(e) => setName(e.target.value)} onEnter={submit} />
      <Field id="email" label="Email address" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onEnter={submit} />
      <PasswordField value={password} onChange={setPassword} onEnter={submit} />
      <CheckRow
        checked={isAdult}
        onChange={setIsAdult}
        title="Adult Age Verification Gate"
        desc="I verify that I am at least 18 years of age and legally authorized to supervise the child."
      />
      <CheckRow
        checked={consent}
        onChange={setConsent}
        title="COPPA & GDPR-K Parental Consent"
        desc="I give verified parental consent for my child to create stories in this encrypted, ad-free studio."
      />
      <Button className="mt-2 w-full" disabled={!canSubmit} onClick={submit}>
        {busy ? "Creating account…" : "Create Account"} <Arrow />
      </Button>
      <SocialRow label="Or sign up with" />
      <p className="mt-5 text-center text-xs text-ink-muted">
        Already have an account?{" "}
        <Link href={ROUTES.login} className="font-bold text-ink underline">
          Log in here
        </Link>
      </p>
    </AuthFrame>
  );
}

export function LoginScreen() {
  const [, navigate] = useLocation();
  const { updateParent } = useAppState();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(false);
  const { busy, error, run } = useAction();

  const canSubmit = email.includes("@") && !!password && !busy;
  const signIn = () => {
    if (!canSubmit) return;
    void run(async () => {
      const user = await auth.login(email, password, remember);
      updateParent({ holder: "parent", account: { name: user.name, email: user.email, emailVerified: user.emailVerified } });
      // Returning parents land on the dashboard; new accounts go through child setup.
      // Email not confirmed yet: everything else is refused until it is, so go where a new
      // link can be sent (the first one may have expired, or never arrived).
      navigate(user.emailVerified ? ROUTES.dashboard : ROUTES.verifyEmail);
    });
  };

  return (
    <AuthFrame title="Log in">
      <ErrorNote error={error} />
      <Field id="email" label="Email Address" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onEnter={signIn} />
      <PasswordField value={password} onChange={setPassword} onEnter={signIn} />
      <div className="-mt-1 mb-5 flex items-center justify-between text-xs">
        <label className="flex items-center gap-2 text-ink-muted">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="accent-brand" />
          Remember me
        </label>
        <Link href={ROUTES.forgotPassword} className="text-ink-muted hover:text-ink">
          Forgot password?
        </Link>
      </div>
      <Button className="w-full" disabled={!canSubmit} onClick={signIn}>
        {busy ? "Signing in…" : "Sign In"} <Arrow />
      </Button>
      <SocialRow label="Or continue with" />
      <p className="mt-5 text-center text-xs text-ink-muted">
        New here?{" "}
        <Link href={ROUTES.signup} className="font-bold text-ink underline">
          Create an account
        </Link>
      </p>
    </AuthFrame>
  );
}

/**
 * /verify-email?token=...  opened from the email: confirms the address.
 * /verify-email            right after sign-up, or logging in before confirming: "check your
 *                          inbox", with a resend button.
 */
export function VerifyEmailScreen() {
  const token = new URLSearchParams(useSearch()).get("token");
  const { parent, updateParent } = useAppState();
  const [result, setResult] = useState<"working" | "verified" | ApiError | null>(token ? "working" : null);
  const [resent, setResent] = useState(false);
  const resend = useAction();
  // React's StrictMode runs effects twice in development. A link works only ONCE, so this
  // makes sure we send it only once.
  const sent = useRef(false);

  useEffect(() => {
    if (!token || sent.current) return;
    sent.current = true;
    auth
      .verifyEmail(token)
      .then(() => {
        setResult("verified");
        if (parent.account) updateParent({ account: { ...parent.account, emailVerified: true } });
      })
      .catch((err: unknown) => setResult(asApiError(err)));
    // Run once per token; parent/updateParent are only read when it finishes.
  }, [token]);

  const loggedIn = !!parent.account;
  const next = loggedIn ? (
    <LinkButton href={ROUTES.children} className="w-full">
      Continue to child profiles <Arrow />
    </LinkButton>
  ) : (
    <LinkButton href={ROUTES.login} className="w-full">
      Log in <Arrow />
    </LinkButton>
  );
  const resendButton = loggedIn && !parent.account?.emailVerified && (
    <Button
      variant="outline"
      className="mt-3 w-full"
      disabled={resend.busy || resent}
      onClick={() => void resend.run(async () => {
        await auth.resendVerification();
        setResent(true);
      })}
    >
      {resent ? "New link sent" : resend.busy ? "Sending…" : "Send me a new link"}
    </Button>
  );

  if (result === "working") {
    return (
      <AuthFrame title="Confirming your email">
        <Notice>One moment…</Notice>
      </AuthFrame>
    );
  }

  if (result === "verified") {
    return (
      <AuthFrame title="Email confirmed">
        <Notice>Thank you! Your email address is confirmed. You can now add your children's profiles.</Notice>
        {next}
      </AuthFrame>
    );
  }

  if (result instanceof ApiError) {
    return (
      <AuthFrame title="We couldn't confirm your email">
        <ErrorNote error={result} />
        {next}
        {resendButton}
        <ErrorNote error={resend.error} />
      </AuthFrame>
    );
  }

  // No token: just signed up, or logged in before confirming.
  return (
    <AuthFrame title="Check your inbox">
      <Notice>
        We've sent a link to <span className="font-bold">{parent.account?.email ?? "your email address"}</span>. Open it to confirm your
        email. You'll need to confirm it before adding your children's profiles. The link works once, for 24 hours.
        {resendButton && " No email, or the link has expired? Ask for a new one below."}
      </Notice>
      {next}
      {resendButton}
      <ErrorNote error={resend.error} />
    </AuthFrame>
  );
}

export function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const { busy, error, run } = useAction();

  const canSubmit = email.includes("@") && !busy;
  const submit = () => {
    if (!canSubmit) return;
    void run(async () => {
      await auth.forgotPassword(email);
      setSentTo(email);
    });
  };

  return (
    <AuthFrame title="Forgot your password?">
      {sentTo ? (
        <Notice>
          If there's an account for <span className="font-bold">{sentTo}</span>, we've emailed it a link to choose a new password. The link
          works once, for 24 hours.
        </Notice>
      ) : (
        <>
          <p className="mb-4 text-center text-sm text-ink-muted">Enter your email and we'll send you a link to choose a new password.</p>
          <ErrorNote error={error} />
          <Field id="email" label="Email address" type="email" placeholder="name@company.com" value={email} onChange={(e) => setEmail(e.target.value)} onEnter={submit} />
          <Button className="w-full" disabled={!canSubmit} onClick={submit}>
            {busy ? "Sending…" : "Send reset link"} <Arrow />
          </Button>
        </>
      )}
      <p className="mt-5 text-center text-xs text-ink-muted">
        Remembered it?{" "}
        <Link href={ROUTES.login} className="font-bold text-ink underline">
          Log in
        </Link>
      </p>
    </AuthFrame>
  );
}

/** /reset-password?token=...  opened from the reset email. */
export function ResetPasswordScreen() {
  const token = new URLSearchParams(useSearch()).get("token");
  const { updateParent } = useAppState();
  const [password, setPassword] = useState("");
  const [done, setDone] = useState(false);
  const { busy, error, run } = useAction();

  const canSubmit = !!token && password.length >= 8 && !busy;
  const submit = () => {
    if (!canSubmit) return;
    void run(async () => {
      await auth.resetPassword(token, password);
      // The server logged out every device, so forget the local login too.
      updateParent({ account: null, activeChildId: null, order: null, holder: null });
      setDone(true);
    });
  };

  const linkProblem = error && error.code.startsWith("LINK_");

  if (done) {
    return (
      <AuthFrame title="Password changed">
        <Notice>Your password has been changed, and you've been logged out on every device. Log in with your new password.</Notice>
        <LinkButton href={ROUTES.login} className="w-full">
          Log in <Arrow />
        </LinkButton>
      </AuthFrame>
    );
  }

  if (!token) {
    return (
      <AuthFrame title="Choose a new password">
        <Notice>Please open the link from your password reset email.</Notice>
        <LinkButton href={ROUTES.forgotPassword} className="w-full">
          Send me a reset link <Arrow />
        </LinkButton>
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title="Choose a new password">
      <ErrorNote error={error} />
      {linkProblem ? (
        <LinkButton href={ROUTES.forgotPassword} className="w-full">
          Send me a new link <Arrow />
        </LinkButton>
      ) : (
        <>
          <PasswordField label="New password" value={password} onChange={setPassword} onEnter={submit} />
          <p className="-mt-2 mb-4 text-xs text-ink-muted">At least 8 characters, with a letter and a number.</p>
          <Button className="w-full" disabled={!canSubmit} onClick={submit}>
            {busy ? "Saving…" : "Save new password"} <Arrow />
          </Button>
        </>
      )}
    </AuthFrame>
  );
}

/**
 * /ask-parent?next=...  The child holds the device (after a handover) and something needs a
 * grown-up. The parent types their password; the child session ends and the parent's begins
 * (backend BE-04). A wrong password 10 times in 15 minutes is blocked for a while.
 */
export function AskParentScreen() {
  const [, navigate] = useLocation();
  const next = new URLSearchParams(useSearch()).get("next");
  const { activeChild, updateParent, flushStory } = useAppState();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useAction();

  // Only our own pages: a path like "/parent/review", never another website.
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : ROUTES.dashboard;
  const canSubmit = !!password && !busy;
  const submit = () => {
    if (!canSubmit) return;
    void run(async () => {
      // Save the child's last answers while the child session is still open.
      await flushStory();
      const user = await auth.exitChildSession(password);
      updateParent({ holder: "parent", account: { name: user.name, email: user.email, emailVerified: user.emailVerified } });
      navigate(target, { replace: true });
    });
  };

  return (
    <AuthFrame title="Grown-up needed">
      <p className="-mt-3 mb-5 text-center text-sm text-ink-muted">
        {activeChild ? `${activeChild.name} is using Dream Builder.` : "A child is using Dream Builder."} To open the parent
        area, enter the parent's password.
      </p>
      <ErrorNote error={error && error.code === "INVALID_CREDENTIALS" ? new ApiError("That password isn't right.", 401, error.code) : error} />
      <PasswordField value={password} onChange={setPassword} onEnter={submit} />
      <Button className="mt-2 w-full" disabled={!canSubmit} onClick={submit}>
        {busy ? "Checking…" : "Continue as parent"} <Arrow />
      </Button>
      <p className="mt-5 text-center text-xs text-ink-muted">
        <Link href={ROUTES.start} className="font-bold text-ink underline">
          Back to my story
        </Link>
      </p>
    </AuthFrame>
  );
}

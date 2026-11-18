import { useEffect, useState, type ReactNode } from "react";
import { Redirect, useLocation } from "wouter";
import { BookOpen, ChevronDown, Clock, Plus, Smartphone, Trash2 } from "lucide-react";
import { AppShell, CenteredCard } from "@/components/Layout";
import { Arrow, Button, Card, Field, Subtle } from "@/components/ui";
import { LANGUAGES } from "@/data/content";
import { inPreviewMode, modeForAge, modeOf, useAppState, type Mode } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import { startChildSession } from "@/lib/auth";
import * as childrenApi from "@/lib/children";
import { listStories } from "@/lib/stories";
import { cx } from "@/lib/text";
import { ROUTES } from "@/lib/routes";

const MODE_NAME: Record<Mode, string> = { junior: "Explorer", senior: "Creator" };

const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
      {message}
    </p>
  );
}

/**
 * Keeps parent.children in step with the server (backend BE-04): the server's list is the
 * truth, localStorage only a cache. Not called in preview mode (demo data, no login).
 */
export function useServerChildren(): string | null {
  const { parent, updateParent } = useAppState();
  const [problem, setProblem] = useState<string | null>(null);
  const loggedIn = parent.holder === "parent" || (!parent.holder && !!parent.account);

  useEffect(() => {
    if (!loggedIn || inPreviewMode()) return;
    let cancelled = false;
    childrenApi
      .listChildren()
      .then((children) => {
        if (cancelled) return;
        setProblem(null);
        updateParent({ children });
      })
      .catch((err) => !cancelled && setProblem(messageOf(err)));
    return () => {
      cancelled = true;
    };
  }, [loggedIn]); // eslint-disable-line react-hooks/exhaustive-deps

  // A child that the server no longer has can't stay selected.
  useEffect(() => {
    if (parent.activeChildId && !parent.children.some((c) => c.id === parent.activeChildId)) {
      updateParent({ activeChildId: null });
    }
  }, [parent.children]); // eslint-disable-line react-hooks/exhaustive-deps

  return problem;
}

export function ChildrenScreen() {
  const [, navigate] = useLocation();
  const { parent, updateParent } = useAppState();
  const loadProblem = useServerChildren();
  const [problem, setProblem] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const active = parent.children.find((c) => c.id === parent.activeChildId);

  const remove = async (id: string) => {
    setProblem(null);
    setRemoving(id);
    try {
      if (!inPreviewMode()) await childrenApi.removeChild(id);
      updateParent({
        children: parent.children.filter((c) => c.id !== id),
        activeChildId: parent.activeChildId === id ? null : parent.activeChildId,
      });
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setRemoving(null);
    }
  };

  return (
    <AppShell>
      <CenteredCard>
        <Card className="w-full">
          <h1 className="font-display text-[26px] font-bold text-ink">Child profile configuration</h1>
          <Subtle className="mt-1">Filled by parent to set reading level, vocabulary depth, and narration mode.</Subtle>
          <ErrorLine message={problem ?? loadProblem} />

          <button
            type="button"
            onClick={() => navigate(ROUTES.addChild)}
            className="mt-5 flex w-full flex-col items-center gap-2 rounded-2xl border-2 border-dashed border-ink/25 py-8 hover:border-brand/50"
          >
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-brand text-white">
              <Plus className="h-5 w-5" />
            </span>
            <span className="text-xs font-extrabold tracking-wider text-ink">ADD CHILD</span>
          </button>

          <ul className="mt-4 space-y-3">
            {parent.children.map((child) => (
              <li key={child.id}>
                <div
                  className={cx(
                    "flex items-center justify-between rounded-2xl border-[1.5px] bg-tile p-4",
                    child.id === parent.activeChildId ? "border-brand" : "border-transparent",
                  )}
                >
                  <button type="button" className="flex-1 text-left" onClick={() => updateParent({ activeChildId: child.id })}>
                    <span className="block font-display text-lg font-semibold text-ink">{child.name}</span>
                    <span className="text-xs text-ink-muted">
                      {child.age} years • {MODE_NAME[modeOf(child)]} Mode
                    </span>
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove ${child.name}`}
                    disabled={removing === child.id}
                    onClick={() => void remove(child.id)}
                  >
                    <Trash2 className={cx("h-4 w-4", removing === child.id ? "text-ink-muted" : "text-ink")} />
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex justify-center border-t border-ink/10 pt-5">
            <Button disabled={!active} onClick={() => navigate(ROUTES.handover)}>
              {active ? `Ready for Handover to ${active.name}` : "Select a child"} <Arrow />
            </Button>
          </div>
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

export function AddChildScreen() {
  const [, navigate] = useLocation();
  const { parent, updateParent } = useAppState();
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [name, setName] = useState("");
  const [age, setAge] = useState<number | null>(null);
  // null = follow the age (Explorer under 12, Creator from 12); a tap is the parent's choice.
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const mode = chosenMode ?? (age === null ? null : modeForAge(age));
  const canSave = !!name.trim() && age !== null && mode !== null && !busy;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    setProblem(null);
    try {
      const input = { name: name.trim(), age, language, mode };
      const child = inPreviewMode() ? { ...input, id: crypto.randomUUID() } : await childrenApi.addChild(input);
      updateParent({ children: [...parent.children, child], activeChildId: child.id });
      navigate(ROUTES.children);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <CenteredCard>
        <Card className="w-full">
          <h1 className="mb-5 font-display text-[26px] font-bold text-ink">Add your child's details</h1>

          <label htmlFor="language" className="mb-1.5 block text-sm font-semibold text-ink">
            Story &amp; Narration Language
          </label>
          <div className="relative mb-4 inline-block">
            <select
              id="language"
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
              className="appearance-none rounded-lg bg-tile py-2 pl-3 pr-8 text-sm font-bold text-ink"
            >
              {LANGUAGES.map((l) => (
                <option key={l}>{l}</option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-ink" />
          </div>

          {/* Enter saves once an age is picked too (save() checks both). */}
          <Field
            id="child-name"
            label="Child's First Name"
            placeholder="e.g. Alex"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onEnter={() => void save()}
          />

          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-semibold text-ink">Child's age</span>
            {age !== null && mode && (
              <span className="rounded-full bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">
                Age {age} • {MODE_NAME[mode]}
              </span>
            )}
          </div>
          <div className="grid grid-cols-7 gap-2">
            {[8, 9, 10, 11, 12, 13, 14].map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setAge(n)}
                aria-pressed={age === n}
                className={cx(
                  "h-10 rounded-full border text-sm font-semibold",
                  age === n ? "border-brand bg-brand-soft text-brand" : "border-ink/10 bg-[#FAF9FE] text-ink hover:border-brand/40",
                )}
              >
                {n}
              </button>
            ))}
          </div>
          {age !== null && (
            <>
              <Subtle className="mt-3 text-xs">
                {modeForAge(age) === "junior"
                  ? `Based on age ${age}, we recommend Explorer Mode. More pictures, guided audio, less typing.`
                  : `Based on age ${age}, we recommend Creator Mode. Deeper choices, richer words, more of their own writing.`}
              </Subtle>
              {/* The parent may pick the other mode; their choice is what gets stored. */}
              <div className="mt-3 grid grid-cols-2 gap-2" role="radiogroup" aria-label="Story mode">
                {(["junior", "senior"] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={mode === m}
                    onClick={() => setChosenMode(m)}
                    className={cx(
                      "h-10 rounded-full border text-sm font-semibold",
                      mode === m ? "border-brand bg-brand-soft text-brand" : "border-ink/10 bg-[#FAF9FE] text-ink hover:border-brand/40",
                    )}
                  >
                    {MODE_NAME[m]} Mode
                  </button>
                ))}
              </div>
            </>
          )}
          <ErrorLine message={problem} />

          <div className="mt-6 flex justify-between border-t border-ink/10 pt-5">
            <Button variant="outline" onClick={() => navigate(ROUTES.children)}>
              Cancel
            </Button>
            <Button onClick={() => void save()} disabled={!canSave}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </div>
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

export function HandoverScreen() {
  const [, navigate] = useLocation();
  const { activeChild, updateParent, openStory, clearStory } = useAppState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  if (!activeChild) return <Redirect to={ROUTES.children} />;
  const mode = MODE_NAME[modeOf(activeChild)];

  const handOver = async () => {
    setBusy(true);
    setProblem(null);
    try {
      if (inPreviewMode()) {
        navigate(ROUTES.start);
        return;
      }
      // From here the child holds the device: the parent's session on it ends (backend BE-04).
      const child = await startChildSession(activeChild.id);
      updateParent({ holder: "child", activeChildId: child.id });
      // Bring back this child's newest unfinished story, so they can continue it. If that
      // fails, they still start: the library can open it later.
      try {
        const draft = (await listStories()).find((s) => s.status === "draft");
        if (draft) await openStory(draft.id);
        else clearStory(child.id);
      } catch {
        clearStory(child.id);
      }
      navigate(ROUTES.start);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell>
      <CenteredCard>
        <Card className="w-full">
          <h1 className="font-display text-[26px] font-bold text-ink">{activeChild.name}'s Profile is Ready!</h1>
          <Subtle className="mt-1">
            Configured for {mode} Mode (Age {activeChild.age}). {activeChild.name} is ready to create their story. From
            here, the experience is designed just for them.
          </Subtle>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <InfoTile icon={<Clock className="h-4 w-4" />} label="Estimated Time" value="10–20 Minutes" />
            <InfoTile icon={<BookOpen className="h-4 w-4" />} label="Final Keepsake" value="15-Panel Illustrated Story" />
            <InfoTile
              className="col-span-2"
              icon={<Smartphone className="h-4 w-4" />}
              label={`Hand the device to ${activeChild.name}`}
              value={`Pass the screen to ${activeChild.name} and tap the button below to launch their story companion. To come back to the parent area later, you'll need your password.`}
              small
            />
          </div>
          <ErrorLine message={problem} />
          <div className="mt-6 flex flex-col items-center gap-2 border-t border-ink/10 pt-5">
            <Button disabled={busy} onClick={() => void handOver()}>
              {busy ? "Getting ready…" : <>Hand Device to {activeChild.name} &amp; Begin <Arrow /></>}
            </Button>
            <span className="text-[11px] text-ink-muted">Zero adult forms or data collection will be shown to the child.</span>
          </div>
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

function InfoTile({
  icon,
  label,
  value,
  small,
  className,
}: {
  icon: ReactNode;
  label: string;
  value: string;
  small?: boolean;
  className?: string;
}) {
  return (
    <div className={cx("flex items-start gap-3 rounded-xl bg-tile p-3", className)}>
      <span className="mt-1 text-ink">{icon}</span>
      <span>
        <span className={cx("block", small ? "text-sm font-bold text-ink" : "text-[11px] text-ink-muted")}>{label}</span>
        <span className={cx("block", small ? "text-xs text-ink-muted" : "text-sm font-bold text-ink")}>{value}</span>
      </span>
    </div>
  );
}

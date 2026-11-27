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
  const { parent, updateParent, story, clearStory } = useAppState();
  const loadProblem = useServerChildren();
  const [problem, setProblem] = useState<string | null>(null);
  // The child whose "delete data" panel is open (FE-12, backend BE-16).
  const [deleting, setDeleting] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const active = parent.children.find((c) => c.id === parent.activeChildId);

  // After the server accepted the deletion: the child is gone from this screen straight away.
  const removed = (id: string, message: string) => {
    updateParent({
      children: parent.children.filter((c) => c.id !== id),
      activeChildId: parent.activeChildId === id ? null : parent.activeChildId,
    });
    if (story.childId === id) clearStory();
    setDeleting(null);
    setNotice(message);
  };

  return (
    <AppShell>
      <CenteredCard>
        <Card className="w-full">
          <h1 className="font-display text-[26px] font-bold text-ink">Child profile configuration</h1>
          <Subtle className="mt-1">Filled by parent to set reading level, vocabulary depth, and narration mode.</Subtle>
          <ErrorLine message={problem ?? loadProblem} />
          {notice && (
            <p role="status" className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              {notice}
            </p>
          )}

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
                    aria-label={`Delete ${child.name}'s data`}
                    aria-expanded={deleting === child.id}
                    onClick={() => {
                      setProblem(null);
                      setNotice(null);
                      setDeleting(deleting === child.id ? null : child.id);
                    }}
                  >
                    <Trash2 className={cx("h-4 w-4", deleting === child.id ? "text-rose-600" : "text-ink")} />
                  </button>
                </div>
                {deleting === child.id && (
                  <DeletePanel childId={child.id} childName={child.name} onCancel={() => setDeleting(null)} onDeleted={(message) => removed(child.id, message)} />
                )}
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

/**
 * FE-12: deleting a child's data (backend BE-16). Shows what will be deleted and what is kept,
 * asks for the parent's password, then the server takes over (and emails when it's done).
 */
function DeletePanel({
  childId,
  childName,
  onCancel,
  onDeleted,
}: {
  childId: string;
  childName: string;
  onCancel: () => void;
  onDeleted: (message: string) => void;
}) {
  const demo = inPreviewMode();
  const [preview, setPreview] = useState<childrenApi.DeletionPreview | null>(null);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (demo) return;
    childrenApi
      .getDeletionPreview(childId)
      .then(setPreview)
      .catch((err) => setProblem(messageOf(err)));
  }, [childId, demo]);

  const confirm = async () => {
    if (demo) {
      onDeleted(`${childName}'s data has been deleted.`);
      return;
    }
    if (!password || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      const { waitsForPrint } = await childrenApi.requestDeletion(childId, password);
      onDeleted(
        waitsForPrint
          ? `${childName} has been removed. Their data will be deleted as soon as the printed book has shipped, and we'll email you when it's done.`
          : `${childName} has been removed and their data is being deleted. We'll email you when it's done.`,
      );
    } catch (err) {
      setProblem(err instanceof ApiError && err.code === "INVALID_CREDENTIALS" ? "That password isn't right." : messageOf(err));
      setBusy(false);
    }
  };

  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

  return (
    <div className="mt-2 rounded-2xl border-[1.5px] border-rose-200 bg-rose-50/60 p-4 text-sm">
      <p className="font-bold text-ink">Delete {childName}'s data?</p>
      <p className="mt-1 text-ink-muted">This can't be undone.</p>
      {preview ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-rose-700">Deleted</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink">
              <li>{childName}'s profile</li>
              <li>
                {plural(preview.willDelete.stories, "story", "stories")} and {plural(preview.willDelete.comments, "comment", "comments")}
              </li>
              <li>{plural(preview.willDelete.files, "picture or recording", "pictures and recordings")}</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-extrabold uppercase tracking-wide text-ink-muted">Kept</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-ink-muted">
              {preview.kept.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
          </div>
        </div>
      ) : (
        !demo && !problem && <p className="mt-3 text-ink-muted">Checking what will be deleted…</p>
      )}
      {preview?.waitsForPrint && (
        <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-amber-800">
          A printed book is still on its way. {childName} is removed now, and the rest is deleted once it has shipped.
        </p>
      )}
      {!demo && (
        <div className="mt-3">
          <Field
            id={`delete-password-${childId}`}
            label="Your password, to confirm"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onEnter={() => void confirm()}
          />
        </div>
      )}
      <ErrorLine message={problem} />
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="bg-rose-600 hover:bg-rose-700" disabled={busy || (!demo && !password)} onClick={() => void confirm()}>
          {busy ? "Deleting…" : `Delete ${childName}'s data`}
        </Button>
        <Button variant="outline" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

export function AddChildScreen() {
  const [, navigate] = useLocation();
  const { parent, updateParent } = useAppState();
  const [language, setLanguage] = useState(LANGUAGES[0]);
  const [name, setName] = useState("");
  const [age, setAge] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // The mode always follows the age: under 12 is Explorer, 12 and over is Creator.
  const mode = age === null ? null : modeForAge(age);
  const childName = name.trim() || "your child";
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
          {age !== null && mode && (
            <Subtle className="mt-3 text-xs">
              {mode === "junior"
                ? `At age ${age}, ${childName} will use Explorer Mode: more pictures, guided audio, less typing.`
                : `At age ${age}, ${childName} will use Creator Mode: deeper choices, richer words, more of their own writing.`}
            </Subtle>
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

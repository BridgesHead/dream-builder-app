import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, Circle, ImageIcon, Loader2, Pencil, Sparkles, Wand2 } from "lucide-react";
import { AppShell, CenteredCard } from "@/components/Layout";
import { BookCover } from "@/components/BookCover";
import { Flipbook } from "@/components/Flipbook";
import { pageText } from "@/data/storyText";
import { Arrow, Button, Card, Heading, LinkButton, Subtle } from "@/components/ui";
import { heroAvatar } from "@/data/assets";
import { inPreviewMode, useAppState } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import {
  editPanel,
  generateStory,
  getGenerationStatus,
  getReviewStory,
  listComments,
  redrawPanel,
  retryGeneration,
  rewriteSentence,
  routeForStep,
  submitStory,
  type GenerationStatus,
  type ReviewStory,
} from "@/lib/stories";
import { possessive } from "@/lib/text";
import { ROUTES } from "@/lib/routes";

const PAGES = 15;

/** Generation stages; each runs until progress reaches `until` (%). */
const GEN_STEPS: { label: string; until: number; status: (page: number) => string }[] = [
  { label: "Reading your choices", until: 12, status: () => "Gathering your hero, feelings and brave moves…" },
  { label: "Writing the story", until: 52, status: (p) => `Writing page ${p} of ${PAGES}…` },
  { label: "Creating the pictures", until: 92, status: (p) => `Illustrating page ${p} of ${PAGES}…` },
  { label: "Putting your book together", until: 100, status: () => "Binding the pages…" },
];

const POLL_MS = 2000;
const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

// Final Climb (FE-06). The server makes the story in the background (backend BE-07):
//   1. ask it to start; if a step is missing, the child goes straight back to it (BE-08),
//      so the book never shows empty pages
//   2. ask "how far along?" every 2 seconds and show the real progress
//   3. a job that failed every try shows a "Try again" button
// Preview mode (demo data, no login) keeps the old animation.
export function GeneratingScreen() {
  const [, navigate] = useLocation();
  const { story, updateStory, storyId, flushStory } = useAppState();
  const demo = inPreviewMode() || !storyId;
  const [demoProgress, setDemoProgress] = useState(0);
  const [server, setServer] = useState<GenerationStatus | null>(null);
  const [started, setStarted] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // 1. Start (or find it already started).
  useEffect(() => {
    if (demo) return;
    let cancelled = false;
    void (async () => {
      try {
        await flushStory();
        const status = await generateStory(storyId);
        if (!cancelled) setServer(status);
      } catch (err) {
        const missing = err instanceof ApiError && err.code === "STORY_INCOMPLETE" ? err.fields.missingSteps : undefined;
        if (cancelled) return;
        if (missing?.length) {
          navigate(routeForStep(missing[0]), { replace: true });
          return;
        }
        // Already being made (e.g. the page was reloaded): just follow it.
        if (!(err instanceof ApiError && err.code === "INVALID_STATUS_CHANGE")) setProblem(messageOf(err));
      }
      if (!cancelled) setStarted(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // 2. Follow the real status.
  useEffect(() => {
    if (demo || !started) return;
    let cancelled = false;
    const check = () =>
      getGenerationStatus(storyId)
        .then((status) => {
          if (cancelled) return;
          setServer(status);
          setProblem(null);
        })
        .catch((err) => !cancelled && setProblem(messageOf(err)));
    void check();
    const id = setInterval(() => void check(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [started]); // eslint-disable-line react-hooks/exhaustive-deps

  // Preview mode: the old timer.
  useEffect(() => {
    if (!demo) return;
    const id = setInterval(() => setDemoProgress((p) => Math.min(p + 4, 100)), 120);
    return () => clearInterval(id);
  }, [demo]);

  const progress = demo ? demoProgress : (server?.progress ?? 0);
  const finished = demo ? demoProgress >= 100 : !!server && server.status !== "draft" && server.status !== "generating";

  useEffect(() => {
    if (!finished) return;
    updateStory({ storyGeneratedAt: new Date().toISOString() });
    navigate(ROUTES.ready);
  }, [finished]); // eslint-disable-line react-hooks/exhaustive-deps

  // 3. "Try again" for jobs that failed every try.
  const tryAgain = async () => {
    if (!storyId) return;
    setRetrying(true);
    try {
      setServer(await retryGeneration(storyId));
      setProblem(null);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setRetrying(false);
    }
  };

  const book = story.selectedFormat === "comic" ? "Comic Book" : "Storybook";
  const current = GEN_STEPS.findIndex((s) => progress < s.until);
  const active = current === -1 ? GEN_STEPS.length - 1 : current;
  const step = GEN_STEPS[active];
  // Page count within the active stage, so "page X of 15" restarts for the pictures.
  const from = active === 0 ? 0 : GEN_STEPS[active - 1].until;
  const page = Math.min(PAGES, Math.max(1, Math.ceil(((progress - from) / (step.until - from)) * PAGES)));
  const status = step.status(page);

  return (
    <AppShell>
      <CenteredCard width="max-w-[480px]">
        <Card className="w-full p-0 text-center sm:p-0">
          <div className="px-8 pb-6 pt-8">
            <Sparkles className="mx-auto h-12 w-12 text-brand" aria-hidden />
            <h1 className="mt-5 text-base font-bold text-ink">Your Story Is Coming to Life</h1>
            <Subtle className="mt-1">We're writing the story and creating its pictures.</Subtle>
            {/* Live checklist: each stage is waiting, in progress (spinner) or done. */}
            <ol className="mx-auto mt-6 w-fit space-y-2.5 text-left text-sm">
              {GEN_STEPS.map((s, i) => {
                const done = progress >= s.until;
                const running = !done && i === active;
                return (
                  <li key={s.label} className="flex items-center gap-2.5">
                    {done ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" aria-hidden />
                    ) : running ? (
                      <Loader2 className="h-4 w-4 shrink-0 animate-spin text-brand" aria-hidden />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    )}
                    <span className={done ? "text-ink" : running ? "font-bold text-ink" : "text-ink-faint"}>{s.label}</span>
                    <span className="sr-only">{done ? "(done)" : running ? "(in progress)" : "(waiting)"}</span>
                  </li>
                );
              })}
            </ol>
            <div className="mt-6 flex justify-between gap-4 text-xs text-ink">
              {/* Announced to screen readers as it changes. */}
              <span role="status" aria-live="polite" className="text-left">
                {book}: {status}
              </span>
              <span className="font-bold tabular-nums">{progress}%</span>
            </div>
            <div
              className="mt-2 h-2 overflow-hidden rounded-full bg-tile"
              role="progressbar"
              aria-label={`Creating your ${book.toLowerCase()}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
            >
              <div className="h-full rounded-full bg-brand/70 transition-all" style={{ width: `${progress}%` }} />
            </div>
            {/* A job failed every try (FE-06 retry state). */}
            {server?.canRetry && (
              <div role="alert" className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                <p className="font-semibold">Part of your story didn't work this time.</p>
                <Button className="mt-3" disabled={retrying} onClick={() => void tryAgain()}>
                  {retrying ? "Trying again…" : "Try again"} <Arrow />
                </Button>
              </div>
            )}
            {problem && !server?.canRetry && (
              <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">
                {problem}
              </p>
            )}
          </div>
          <div className="border-t border-ink/10 py-4">
            <LinkButton href={ROUTES.start} variant="outline">
              Finish Later
            </LinkButton>
          </div>
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

export function ReadyScreen() {
  const { story, mode, heroName } = useAppState();
  return (
    <AppShell>
      <div className="my-auto flex flex-col items-center text-center">
        <Heading>Your Story Is Ready</Heading>
        <BookCover
          className="mt-8"
          title={`${possessive(heroName)} Magical Journey`}
          author={story.authorName || "Author Name"}
          edition={mode === "senior" ? "Creator" : "Explorer"}
          asset="Cover art: hero portrait"
          assetSrc={story.heroType ? heroAvatar(story.heroType) : undefined}
        />
        <LinkButton href={ROUTES.book} className="mt-8">
          Open My Story <Arrow />
        </LinkButton>
      </div>
    </AppShell>
  );
}

const REDRAW_POLL_MS = 2000;

/** The first sentence of a page, as a starting point for the sentence helper. */
const firstSentence = (text: string) => text.trim().split(/(?<=[.!?])\s+/)[0] ?? "";

// The child's review of the made story (FE-08, backend BE-12):
//   - the pages show the server's text and pictures
//   - "Edit My Story" → "Save Changes" saves each changed page (the server keeps the old words)
//   - "New Picture" redraws one page in the background; the old picture stays until it's ready
//   - Creator mode: the sentence helper suggests one better sentence; "Use it" puts it in the page
//   - "I'm Done!" sends the story to a parent (parent_review)
// Preview mode (demo data, no login) keeps the old local-only book.
export function BookScreen() {
  const [, navigate] = useLocation();
  const { story, updateStory, heroName, storyId } = useAppState();
  const demo = inPreviewMode() || !storyId;
  const [editing, setEditing] = useState(false);
  const [at, setAt] = useState<{ part: number | null; atEnd: boolean }>({ part: null, atEnd: false });
  // Changed words per page, not saved yet.
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [server, setServer] = useState<ReviewStory | null>(null);
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<null | "saving" | "submitting">(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [redrawing, setRedrawing] = useState<number | null>(null);
  const [redrawNote, setRedrawNote] = useState<string | null>(null);
  // Sentence helper (Creator mode).
  const [sentence, setSentence] = useState("");
  const [suggestion, setSuggestion] = useState<string | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  const load = async (id: string) => {
    const [loaded, comments] = await Promise.all([getReviewStory(id), listComments(id)]);
    setServer(loaded);
    // The parent's notes per page, shown as tabs on the pages (after a change request).
    const byPage: Record<number, string> = {};
    for (const c of comments) if (c.panelNumber) byPage[c.panelNumber] = [byPage[c.panelNumber], c.text].filter(Boolean).join("\n");
    setNotes(byPage);
  };

  useEffect(() => {
    if (demo || !storyId) return;
    load(storyId).catch((err) => setProblem(messageOf(err)));
  }, [demo, storyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // While a page is being redrawn, ask every 2 seconds whether it's finished.
  useEffect(() => {
    if (redrawing === null || !storyId) return;
    const timer = setInterval(() => {
      getGenerationStatus(storyId)
        .then(async (status) => {
          const r = status.redraws?.find((x) => x.panelNumber === redrawing);
          if (!r || r.status === "queued" || r.status === "running") return;
          setRedrawing(null);
          if (r.status === "failed") setRedrawNote("The new picture didn't work, so the old one stayed. You can try again.");
          else setRedrawNote("Your new picture is ready!");
          await load(storyId);
        })
        .catch((err) => setProblem(messageOf(err)));
    }, REDRAW_POLL_MS);
    return () => clearInterval(timer);
  }, [redrawing, storyId]); // eslint-disable-line react-hooks/exhaustive-deps

  const serverPanel = (p: number) => server?.panels.find((x) => x.number === p);
  const textFor = (p: number) => edits[p] ?? serverPanel(p)?.text ?? pageText(p, story, heroName);
  const locked = !!server && server.status !== "child_review";
  const creator = server?.mode === "senior";
  const page = at.part;

  /** Sends the changed pages. Returns false if something couldn't be saved. */
  const saveEdits = async (): Promise<boolean> => {
    if (demo || !storyId) return true;
    const changed = Object.entries(edits)
      .map(([p, text]) => ({ number: Number(p), text: text.trim() }))
      .filter((e) => e.text && e.text !== serverPanel(e.number)?.text);
    if (changed.length === 0) return true;
    setBusy("saving");
    try {
      for (const e of changed) await editPanel(storyId, e.number, e.text);
      await load(storyId);
      setEdits({});
      setProblem(null);
      return true;
    } catch (err) {
      setProblem(messageOf(err));
      return false;
    } finally {
      setBusy(null);
    }
  };

  const toggleEditing = async () => {
    if (editing && !(await saveEdits())) return;
    setSuggestion(null);
    setEditing(!editing);
  };

  const finish = async () => {
    if (demo || !storyId) {
      updateStory({ confirmedByChild: true });
      navigate(ROUTES.done);
      return;
    }
    if (!(await saveEdits())) return;
    setBusy("submitting");
    try {
      await submitStory(storyId);
    } catch (err) {
      // Already with a parent (e.g. tapped twice): that's fine, carry on.
      const alreadySent =
        err instanceof ApiError && err.code === "STORY_LOCKED" && (await getReviewStory(storyId).catch(() => null))?.status === "parent_review";
      if (!alreadySent) {
        setProblem(messageOf(err));
        setBusy(null);
        return;
      }
    }
    setBusy(null);
    updateStory({ confirmedByChild: true });
    navigate(ROUTES.done);
  };

  const newPicture = async () => {
    if (!storyId || page === null) return;
    setRedrawNote(null);
    try {
      const { redrawsLeft } = await redrawPanel(storyId, page);
      setRedrawing(page);
      setRedrawNote(`Drawing a new picture… (${redrawsLeft} more new picture${redrawsLeft === 1 ? "" : "s"} left for this story)`);
    } catch (err) {
      setRedrawNote(messageOf(err));
    }
  };

  const suggest = async () => {
    if (!storyId || page === null || !sentence.trim()) return;
    setSuggesting(true);
    setSuggestion(null);
    try {
      setSuggestion(await rewriteSentence(storyId, page, sentence.trim()));
      setProblem(null);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setSuggesting(false);
    }
  };

  const applySuggestion = () => {
    if (page === null || !suggestion) return;
    const current = textFor(page);
    const next = current.includes(sentence.trim()) ? current.replace(sentence.trim(), suggestion) : `${current} ${suggestion}`.trim();
    setEdits((e) => ({ ...e, [page]: next }));
    setSentence(suggestion);
    setSuggestion(null);
  };

  const canRedraw = !demo && !locked && !editing && page !== null && !!serverPanel(page)?.imageUrl && redrawing === null;

  return (
    <AppShell>
      <div className="my-auto flex w-full flex-col items-center">
        <Heading className="text-center">Your Story Is Ready</Heading>
        <Subtle className="mb-8 mt-1 text-center">Open the cover and turn the pages of {possessive(heroName)} adventure.</Subtle>
        <Flipbook
          textFor={textFor}
          editing={editing}
          onTextChange={(p, v) => setEdits((e) => ({ ...e, [p]: v }))}
          onPositionChange={(next) => {
            setAt(next);
            if (next.part !== at.part) {
              setSuggestion(null);
              setSentence(next.part !== null ? firstSentence(textFor(next.part)) : "");
            }
          }}
          notes={notes}
          imageFor={(p) => serverPanel(p)?.imageUrl}
          endAction={
            <Button className="h-11 shrink-0 px-5" disabled={busy !== null || locked} onClick={() => void finish()}>
              {busy === "submitting" ? "Sending…" : "I'm Done!"} <Arrow />
            </Button>
          }
        />

        {editing && creator && page !== null && (
          <Card className="mt-6 w-full max-w-[880px] border-2 border-brand/20 p-5 sm:p-5">
            <label htmlFor="sentence" className="flex items-center gap-2 text-sm font-bold text-ink">
              <Wand2 className="h-4 w-4 text-brand" aria-hidden /> Sentence helper
            </label>
            <Subtle className="mt-1 text-xs">Paste a sentence from this page and get one fresh way to say it.</Subtle>
            <textarea
              id="sentence"
              rows={2}
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              className="mt-2 w-full resize-none rounded-xl border border-ink/15 p-3 text-sm focus:border-brand focus:outline-none"
            />
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <Button variant="outline" disabled={suggesting || !sentence.trim()} onClick={() => void suggest()}>
                {suggesting ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />} Suggest
              </Button>
            </div>
            {suggestion && (
              <div className="mt-3 rounded-xl bg-brand-soft/40 p-3 text-sm text-ink">
                <p className="italic">{suggestion}</p>
                <div className="mt-2 flex gap-2">
                  <Button className="h-9 px-4" onClick={applySuggestion}>
                    Use it
                  </Button>
                  <Button variant="outline" className="h-9 px-4" onClick={() => setSuggestion(null)}>
                    Keep mine
                  </Button>
                </div>
              </div>
            )}
          </Card>
        )}

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {!locked && (
            <Button disabled={busy !== null} onClick={() => void toggleEditing()}>
              <Pencil className="h-4 w-4" /> {busy === "saving" ? "Saving…" : editing ? "Save Changes" : "Edit My Story"}
            </Button>
          )}
          {canRedraw && (
            <Button variant="outline" className="border-ink/10 shadow-sm" onClick={() => void newPicture()}>
              <ImageIcon className="h-4 w-4" aria-hidden /> New Picture for This Page
            </Button>
          )}
        </div>
        {(problem || redrawNote) && (
          <p role="status" aria-live="polite" className="mt-3 max-w-md text-center text-xs font-semibold text-amber-700">
            {redrawing !== null && <Loader2 className="mr-1 inline h-3 w-3 animate-spin" aria-hidden />}
            {problem ?? redrawNote}
          </p>
        )}
        <Subtle className="mt-3 text-center text-xs">
          {locked
            ? "A grown-up is looking at your story now."
            : editing && at.part === null
              ? "Turn to a story page to change its words."
              : at.atEnd
                ? "Tap “I'm Done!” when your story is finished."
                : "Read to the last page and tap “I'm Done!” when your story is finished."}
        </Subtle>
      </div>
    </AppShell>
  );
}

export function DoneScreen() {
  return (
    <AppShell>
      <CenteredCard width="max-w-[656px]">
        <Card className="w-full text-center">
          <Heading>Your Story Is Ready!</Heading>
          <Subtle className="mx-auto mt-2 max-w-xs">
            Your adventure is ready to share. Ask your parent to review your story and help you get your book.
          </Subtle>
          <div className="mt-6">
            <LinkButton href={ROUTES.review}>
              Ask a Parent to Continue <Arrow />
            </LinkButton>
          </div>
        </Card>
      </CenteredCard>
    </AppShell>
  );
}

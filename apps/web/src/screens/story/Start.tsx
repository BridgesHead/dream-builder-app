import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { BookOpen, LayoutDashboard, Wand2 } from "lucide-react";
import { AppShell } from "@/components/Layout";
import { Arrow, Button, Card, LinkButton, Subtle } from "@/components/ui";
import { HEROES } from "@/data/content";
import { inPreviewMode, useAppState, type StoryState } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import { listStories, type StorySummary } from "@/lib/stories";
import { possessive } from "@/lib/text";
import { actStart, ROUTES } from "@/lib/routes";
import type { Mode } from "@/state/AppState";

/** Where to resume an unfinished draft, and how far along it is. */
export function resumePoint(story: StoryState, mode: Mode): { href: string; chapter: number } {
  if (story.storyGeneratedAt) return { href: ROUTES.book, chapter: 7 };
  if (story.facesChallenge3 !== null) return { href: actStart(3, mode), chapter: 7 };
  if (story.obstacles2.length) return { href: ROUTES.gate, chapter: 6 };
  if (story.safePlaceText) return { href: actStart(2, mode), chapter: 5 };
  if (story.obstacles.length) return { href: ROUTES.rest, chapter: 4 };
  if (story.aspiration) return { href: actStart(1, mode), chapter: 3 };
  if (story.charStrengths.length) return { href: ROUTES.dream, chapter: 2 };
  return { href: ROUTES.hero, chapter: 1 };
}

function DraftCard() {
  const { story, mode, heroName } = useAppState();
  if (!story.heroType) return null;
  const { href, chapter } = resumePoint(story, mode);
  const hero = HEROES.find((h) => h.id === story.heroType);

  return (
    <Card className="flex flex-col p-5 sm:p-5">
      <div className="flex items-center justify-between">
        <span className="rounded-md bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">
          Chapter {chapter} of 7 • In Progress
        </span>
      </div>
      <h3 className="mt-3 font-display text-lg font-bold text-ink">{possessive(heroName)} Magical Journey</h3>
      <Subtle className="mt-2 flex-1 text-xs">
        {hero?.title}
        {story.aspiration && ` who dreams to ${story.aspiration.toLowerCase()}`}.
      </Subtle>
      <div className="mt-4 flex justify-end border-t border-ink/10 pt-4">
        <LinkButton href={href} className="h-9 px-4">
          Continue My Story <Arrow />
        </LinkButton>
      </div>
    </Card>
  );
}

const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

export function StartScreen() {
  const [, navigate] = useLocation();
  const { story, storyId, startNewStory, clearStory, parent, mode } = useAppState();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // Only a story saved on the server can be continued (demo data in preview mode too).
  const hasDraft = !!story.heroType && (!!storyId || inPreviewMode());

  const startNew = async () => {
    setBusy(true);
    setProblem(null);
    try {
      // A new draft on the server for the child holding the device (backend BE-08).
      if (inPreviewMode()) clearStory(parent.activeChildId);
      else await startNewStory();
      navigate(ROUTES.author);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      right={
        <div className="flex items-center gap-2">
          {/* Icon-only on phones so both fit beside the logo. */}
          <LinkButton href={ROUTES.library} className="h-9 px-3 sm:px-4">
            <BookOpen className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Story Library</span>
          </LinkButton>
          <LinkButton href={ROUTES.dashboard} variant="outline" className="h-9 px-3 sm:px-4">
            <LayoutDashboard className="h-4 w-4" /> <span className="sr-only sm:not-sr-only">Dashboard</span>
          </LinkButton>
        </div>
      }
    >
      <section className="mx-auto flex max-w-3xl flex-col items-center text-center">
        <span className="rounded-md border border-brand/50 px-3 py-1 text-[11px] font-bold tracking-widest text-brand">
          INTERACTIVE STORY STUDIO FOR YOUNG AUTHORS
        </span>
        <h1 className="mt-8 font-display text-5xl font-medium leading-[0.95] tracking-[-0.03em] text-ink sm:text-[80px]">
          Create a Story <br />
          That's <span className="text-brand">Yours</span>
        </h1>
        <p className="mt-6 text-ink">
          {mode === "senior"
            ? "Choose a hero, shape their dream, and build a story that sounds like you."
            : "Choose a hero, give them a dream, and help them find a way through something difficult."}
        </p>
        <Button className="mt-7" disabled={busy} onClick={() => void startNew()}>
          <Wand2 className="h-4 w-4" /> {busy ? "Getting your story ready…" : "Start a New Story"} <Arrow />
        </Button>
        {problem && (
          <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
            {problem}
          </p>
        )}
      </section>

      {hasDraft && (
        <section className="mx-auto mt-14 w-full max-w-[1000px] text-center">
          <h2 className="font-display text-2xl font-bold text-ink">Continue an Existing Story</h2>
          <Subtle className="mt-1">Jump back into a story in progress.</Subtle>
          <div className="mx-auto mt-6 grid max-w-[496px] text-left">
            <DraftCard />
          </div>
        </section>
      )}

      <p className="mt-auto pt-12 text-center text-xs text-ink-muted">
        Grown-up?{" "}
        <Link href={ROUTES.dashboard} className="font-bold underline">
          Parent area
        </Link>
      </p>
    </AppShell>
  );
}

const STATUS_LABEL: Record<StorySummary["status"], string> = {
  draft: "In Progress",
  generating: "Being Made",
  child_review: "Ready to Read",
  parent_review: "With a Parent",
  approved: "Finished",
};

/** Every story this child has started or finished, from the server (backend BE-08). */
export function LibraryScreen() {
  const [, navigate] = useLocation();
  const { story, storyId, openStory } = useAppState();
  const [stories, setStories] = useState<StorySummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [opening, setOpening] = useState<string | null>(null);
  const preview = inPreviewMode();

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    listStories()
      .then((list) => !cancelled && setStories(list))
      .catch((err) => !cancelled && setProblem(messageOf(err)));
    return () => {
      cancelled = true;
    };
  }, [preview]);

  const open = async (id: string) => {
    setOpening(id);
    setProblem(null);
    try {
      await openStory(id);
      setOpening(null);
      navigate(ROUTES.start);
    } catch (err) {
      setProblem(messageOf(err));
      setOpening(null);
    }
  };

  // The story already open on this device shows as the full draft card.
  const others = (stories ?? []).filter((s) => s.id !== storyId);
  const showCurrent = !!story.heroType && (preview || (stories ?? []).some((s) => s.id === storyId));
  const empty = stories !== null && stories.length === 0 && !preview;

  return (
    <AppShell right={<LinkButton href={ROUTES.start} variant="outline">← Home</LinkButton>}>
      <h1 className="mt-4 font-display text-4xl font-semibold text-ink">Story Library</h1>
      <Subtle className="mt-1">Every story you've started or finished lives here.</Subtle>
      {problem && (
        <p role="alert" className="mt-4 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {problem}
        </p>
      )}
      <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {showCurrent && <DraftCard />}
        {others.map((s) => (
          <Card key={s.id} className="flex flex-col p-5 sm:p-5">
            <span className="w-fit rounded-md bg-brand-soft px-2 py-0.5 text-[11px] font-bold text-brand">{STATUS_LABEL[s.status]}</span>
            <h3 className="mt-3 font-display text-lg font-bold text-ink">{s.title || "A story in progress"}</h3>
            <Subtle className="mt-2 flex-1 text-xs">Last changed {new Date(s.updatedAt).toLocaleDateString()}</Subtle>
            <div className="mt-4 flex justify-end border-t border-ink/10 pt-4">
              <Button className="h-9 px-4" disabled={opening !== null} onClick={() => void open(s.id)}>
                {opening === s.id ? "Opening…" : s.status === "draft" ? "Continue" : "Open"} <Arrow />
              </Button>
            </div>
          </Card>
        ))}
        {stories === null && !preview && !problem && <Subtle>Loading your stories…</Subtle>}
        {empty && (
          <Card className="col-span-full text-center">
            <p className="font-display text-xl text-ink">No stories yet</p>
            <Subtle className="mt-1">Start a new story and it will show up here.</Subtle>
          </Card>
        )}
      </div>
    </AppShell>
  );
}

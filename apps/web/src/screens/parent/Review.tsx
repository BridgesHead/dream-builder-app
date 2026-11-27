import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { MessageSquare } from "lucide-react";
import { AppShell } from "@/components/Layout";
import { Flipbook } from "@/components/Flipbook";
import { pageText } from "@/data/storyText";
import { PANEL_LABELS } from "@/data/content";
import { Button, Card, Heading, Subtle } from "@/components/ui";
import { inPreviewMode, useAppState } from "@/state/AppState";
import { ApiError } from "@/lib/api";
import { addComments, approveStory, getReviewStory, listComments, type ReviewStory, type StoryComment } from "@/lib/stories";
import { possessive } from "@/lib/text";
import { ROUTES } from "@/lib/routes";

const messageOf = (err: unknown) => (err instanceof ApiError ? err.message : "Something went wrong. Please try again.");

/**
 * Parent review (FE-10, backend BE-12): the child's story, read-only, with per-page notes.
 *   - notes are sent as change requests: the story goes back to the child to polish
 *   - "Approve Story" locks it, and checkout can start
 * The notes are stored apart from the child's words and never change them.
 * Preview mode (demo data, no login) keeps the old local-only review.
 */
export function ReviewScreen() {
  const [, navigate] = useLocation();
  const { story, heroName, activeChild, storyId, updateStory } = useAppState();
  const demo = inPreviewMode() || !storyId;
  const [page, setPage] = useState<number | null>(null);
  const [commenting, setCommenting] = useState(false);
  const [comments, setComments] = useState<Record<number, string>>({});
  const [server, setServer] = useState<ReviewStory | null>(null);
  const [earlier, setEarlier] = useState<StoryComment[]>([]);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [sentBack, setSentBack] = useState(false);
  const childName = activeChild?.name ?? "your child";
  const noteCount = Object.values(comments).filter((c) => c.trim()).length;

  useEffect(() => {
    if (demo || !storyId) return;
    Promise.all([getReviewStory(storyId), listComments(storyId)])
      .then(([loaded, list]) => {
        setServer(loaded);
        setEarlier(list);
      })
      .catch((err) => setProblem(messageOf(err)));
  }, [demo, storyId]);

  const serverPanel = (p: number) => server?.panels.find((x) => x.number === p);
  const textFor = (p: number) => serverPanel(p)?.text ?? pageText(p, story, heroName);
  const status = server?.status;

  const approve = async () => {
    if (demo || !storyId) {
      navigate(ROUTES.plans);
      return;
    }
    setBusy(true);
    try {
      if (status !== "approved") await approveStory(storyId);
      navigate(ROUTES.plans);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  const sendChanges = async () => {
    if (demo || !storyId) return;
    const notes = Object.entries(comments)
      .filter(([, text]) => text.trim())
      .map(([p, text]) => ({ panelNumber: Number(p), text: text.trim(), type: "change_request" as const }));
    setBusy(true);
    try {
      await addComments(storyId, notes);
      // Back with the child: their book screen opens again after the handover.
      updateStory({ confirmedByChild: false });
      setComments({});
      setSentBack(true);
      setProblem(null);
    } catch (err) {
      setProblem(messageOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (sentBack || status === "child_review") {
    return (
      <AppShell>
        <div className="my-auto flex w-full flex-col items-center text-center">
          <Heading>Sent Back to {childName}</Heading>
          <Subtle className="mx-auto mt-2 max-w-md">
            {childName} will see your notes on the pages. Hand the device back so they can make their changes and tap “I'm Done!” again.
          </Subtle>
          <Button className="mt-6" onClick={() => navigate(ROUTES.dashboard)}>
            Back to Dashboard
          </Button>
        </div>
      </AppShell>
    );
  }

  // Notes already sent earlier, shown on the pages alongside new ones.
  const shownNotes: Record<number, string> = {};
  for (const c of earlier) if (c.panelNumber) shownNotes[c.panelNumber] = c.text;
  for (const [p, text] of Object.entries(comments)) if (text.trim()) shownNotes[Number(p)] = text;

  return (
    <AppShell>
      <div className="my-auto flex w-full flex-col items-center">
        <Heading className="text-center">Review Your Child's Story</Heading>
        <Subtle className="mb-8 mt-1 text-center">Turn the pages of {possessive(heroName)} adventure, just as it will be printed.</Subtle>
        {/* A comic (backend BE-11) is the same book with 4 comic squares on each page; its notes are for the whole story. */}
        <Flipbook textFor={textFor} notes={shownNotes} imageFor={(p) => serverPanel(p)?.imageUrl} comic={server?.comicCells} onPositionChange={(at) => setPage(at.part)} />

        {commenting && (
          <Card className="mt-6 w-full max-w-[880px] border-2 border-amber-200 p-5 sm:p-5">
            <label htmlFor="comment" className="flex items-center gap-2 text-sm font-bold text-ink">
              <MessageSquare className="h-4 w-4 text-amber-600" /> {page ? `Parent note for “${PANEL_LABELS[page - 1]}”` : "Parent note"}
            </label>
            <textarea
              id="comment"
              rows={3}
              maxLength={2000}
              disabled={page === null}
              value={page ? (comments[page] ?? "") : ""}
              onChange={(e) => page && setComments({ ...comments, [page]: e.target.value })}
              placeholder={page ? "Describe the change you'd like…" : "Turn to a story page to add a note."}
              className="mt-2 w-full resize-none rounded-xl border border-ink/15 bg-amber-50/50 p-3 text-sm focus:border-amber-400 focus:outline-none disabled:cursor-not-allowed disabled:opacity-60"
            />
            <Subtle className="mt-2 text-xs">
              {noteCount} page note(s) so far. Notes are shown separately from {childName}'s own words.
            </Subtle>
          </Card>
        )}

        {/* While notes are being written, finishing them is the only next step. */}
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          {commenting ? (
            <Button onClick={() => setCommenting(false)}>Done Editing Notes</Button>
          ) : status === "approved" ? (
            <Button onClick={() => navigate(ROUTES.plans)}>Continue to Your Book</Button>
          ) : noteCount > 0 ? (
            <>
              <Button disabled={busy || demo} onClick={() => void sendChanges()}>
                {busy ? "Sending…" : `Send Changes to ${childName}`}
              </Button>
              <Button variant="outline" className="border-ink/10 shadow-sm" onClick={() => setCommenting(true)}>
                Edit Notes
              </Button>
            </>
          ) : (
            <>
              <Button disabled={busy} onClick={() => void approve()}>
                {busy ? "Approving…" : "Approve Story"}
              </Button>
              <Button variant="outline" className="border-ink/10 shadow-sm" onClick={() => setCommenting(true)}>
                Request Changes
              </Button>
            </>
          )}
        </div>
        {problem && <p className="mt-3 max-w-md text-center text-xs font-semibold text-red-700">{problem}</p>}
        {!commenting && noteCount > 0 && (
          <p className="mt-3 text-center text-xs font-semibold text-amber-700">
            {noteCount} page note{noteCount === 1 ? "" : "s"} will go back to {childName} to make the changes.
          </p>
        )}
        <Subtle className="mt-3 max-w-md text-center text-xs">
          {status === "approved"
            ? "You approved this story. It can't be changed any more."
            : `This is ${childName}'s story — their words and ideas are what make it special. You can ask for a change, but try to keep it sounding like them.`}
        </Subtle>
      </div>
    </AppShell>
  );
}

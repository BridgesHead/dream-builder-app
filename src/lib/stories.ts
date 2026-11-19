// Story draft calls to the Dream Builder API (backend BE-08). Child session only, except
// reading, which a parent can do too.
import { api } from "./api";
import { actStart, ROUTES } from "./routes";
import { EMPTY_STORY, type Mode, type StoryState } from "@/state/AppState";

/** One row of the story library (no story text). */
export interface StorySummary {
  id: string;
  childId: string;
  title: string | null;
  status: "draft" | "generating" | "child_review" | "parent_review" | "approved";
  mode: Mode;
  storyPath: "two_act" | "three_act" | null;
  createdAt: string;
  updatedAt: string;
}

/** A full story from the server: every StoryState field, plus the server's own. */
type ServerStory = Partial<StoryState> & { id: string; childId: string; status: StorySummary["status"] };

/** The fields only the server sets; never sent in a save. */
const SERVER_ONLY: (keyof StoryState)[] = ["childId", "storyGeneratedAt", "confirmedByChild"];

/** The StoryState part of a server story, so a reopened draft restores every field. */
export function toStoryState(story: ServerStory): StoryState {
  const state = { ...EMPTY_STORY } as Record<string, unknown>;
  for (const key of Object.keys(EMPTY_STORY)) {
    const value = (story as Record<string, unknown>)[key];
    if (value !== undefined) state[key] = value;
  }
  state.childId = story.childId;
  return state as unknown as StoryState;
}

/** Only the fields a wizard save may send. */
export function savableFields(patch: Partial<StoryState>): Partial<StoryState> {
  const out: Partial<StoryState> = { ...patch };
  for (const key of SERVER_ONLY) delete out[key];
  return out;
}

export async function createStory(): Promise<{ id: string; story: StoryState }> {
  const res = await api<{ story: ServerStory }>("/stories", { method: "POST", body: {} });
  return { id: res.story.id, story: toStoryState(res.story) };
}

export async function listStories(): Promise<StorySummary[]> {
  return (await api<{ stories: StorySummary[] }>("/stories")).stories;
}

export async function getStory(id: string): Promise<StoryState> {
  return toStoryState((await api<{ story: ServerStory }>(`/stories/${encodeURIComponent(id)}`)).story);
}

export async function saveStory(id: string, patch: Partial<StoryState>): Promise<void> {
  await api(`/stories/${encodeURIComponent(id)}`, { method: "PATCH", body: patch });
}

type WorkStatus = "queued" | "running" | "success" | "fallback" | "failed";

/** How far along the story is (backend BE-07), for Final Climb. */
export interface GenerationStatus {
  status: StorySummary["status"];
  /** 0–100 */
  progress: number;
  panels: { number: number; textStatus: WorkStatus; imageStatus: WorkStatus }[];
  /** Jobs that failed every try; "Try again" puts them back. */
  failed: { type: string; panelNumber: number | null; error: string | null }[];
  canRetry: boolean;
  /** Picture redraws during review (backend BE-12): the latest one per page. */
  redraws?: RedrawStatus[];
}

export interface RedrawStatus {
  panelNumber: number;
  status: WorkStatus;
  /** Why it failed (the old picture stayed). */
  error: string | null;
  /** true: the child can ask for a new picture again. */
  canRetry: boolean;
}

/**
 * Asks the server to make the story. It refuses an unfinished draft with STORY_INCOMPLETE
 * and the missing steps (ApiError.fields.missingSteps); a story already being made gets
 * INVALID_STATUS_CHANGE.
 */
export async function generateStory(id: string): Promise<GenerationStatus> {
  return (await api<{ status: GenerationStatus }>(`/stories/${encodeURIComponent(id)}/generate`, { method: "POST" })).status;
}

export async function getGenerationStatus(id: string): Promise<GenerationStatus> {
  return (await api<{ status: GenerationStatus }>(`/stories/${encodeURIComponent(id)}/status`)).status;
}

/** "Try again": the jobs that failed every try go back on the list. */
export async function retryGeneration(id: string): Promise<GenerationStatus> {
  return (await api<{ status: GenerationStatus }>(`/stories/${encodeURIComponent(id)}/generate/retry`, { method: "POST" })).status;
}

/** The wizard screen for one of the server's step names (e.g. "act1.feeling" or "gate"). */
export function routeForStep(step: string): string {
  const act = /^act([123])(?:\.(obstacle|feeling|move))?$/.exec(step);
  if (act) return act[2] ? `/story/act/${act[1]}/${act[2]}` : actStart(Number(act[1]) as 1 | 2 | 3, "senior");
  return (ROUTES as Record<string, string>)[step] ?? ROUTES.author;
}

// ---- Draft review (backend BE-12) -------------------------------------------------------------
// The child polishes the made story (child_review), taps "I'm done!", and a parent comments,
// asks for changes or approves (parent_review → approved). Anything outside the right status
// is refused with STORY_LOCKED.

/** One page of the made story, as the server has it. */
export interface StoryPanel {
  number: number;
  text: string;
  /** A short-lived link to the page's picture in our storage, or null. */
  imageUrl: string | null;
  redrawStatus: WorkStatus | null;
}

/** The made story: its status and pages (for the book and review screens). */
export interface ReviewStory {
  status: StorySummary["status"];
  mode: Mode;
  title: string;
  panels: StoryPanel[];
}

export async function getReviewStory(id: string): Promise<ReviewStory> {
  const { story } = await api<{ story: ReviewStory & { panels: (StoryPanel & Record<string, unknown>)[] } }>(`/stories/${encodeURIComponent(id)}`);
  return {
    status: story.status,
    mode: story.mode,
    title: story.title,
    panels: story.panels.map((p) => ({ number: p.number, text: p.text, imageUrl: p.imageUrl ?? null, redrawStatus: p.redrawStatus ?? null })),
  };
}

/** New words for one page; the server keeps the old ones. */
export async function editPanel(id: string, panelNumber: number, text: string): Promise<void> {
  await api(`/stories/${encodeURIComponent(id)}/panels/${panelNumber}`, { method: "PATCH", body: { text } });
}

/** A new picture for one page, drawn in the background. Follow it with getGenerationStatus().redraws. */
export async function redrawPanel(id: string, panelNumber: number): Promise<{ redrawsLeft: number }> {
  return (await api<{ redraw: { redrawsLeft: number } }>(`/stories/${encodeURIComponent(id)}/panels/${panelNumber}/redraw`, { method: "POST" })).redraw;
}

/** Creator mode only: one better way to say a sentence. It changes nothing until the child uses it. */
export async function rewriteSentence(id: string, panelNumber: number, sentence: string): Promise<string> {
  const res = await api<{ suggestion: string }>(`/stories/${encodeURIComponent(id)}/panels/${panelNumber}/rewrite`, { method: "POST", body: { sentence } });
  return res.suggestion;
}

/** "I'm done!": the story goes to a parent for review. */
export async function submitStory(id: string): Promise<void> {
  await api(`/stories/${encodeURIComponent(id)}/submit`, { method: "POST" });
}

export interface StoryComment {
  id: string;
  panelNumber: number | null;
  type: "comment" | "change_request";
  text: string;
  authorName: string | null;
  createdAt: string;
}

export async function listComments(id: string): Promise<StoryComment[]> {
  return (await api<{ comments: StoryComment[] }>(`/stories/${encodeURIComponent(id)}/comments`)).comments;
}

/** The parent's notes. Any change request sends the story back to the child. */
export async function addComments(
  id: string,
  comments: { panelNumber: number | null; text: string; type: "comment" | "change_request" }[],
): Promise<{ status: StorySummary["status"] }> {
  return api(`/stories/${encodeURIComponent(id)}/comments`, { method: "POST", body: { comments } });
}

/** The parent approves: the story is locked, and can be bought. */
export async function approveStory(id: string): Promise<void> {
  await api(`/stories/${encodeURIComponent(id)}/approve`, { method: "POST" });
}

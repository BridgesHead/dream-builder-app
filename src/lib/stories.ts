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

/**
 * Asks the server to make the story. It refuses an unfinished draft with STORY_INCOMPLETE
 * and the missing steps (ApiError.fields.missingSteps); until the job queue exists (BE-07)
 * a finished draft gets GENERATION_NOT_READY.
 */
export function generateStory(id: string): Promise<void> {
  return api(`/stories/${encodeURIComponent(id)}/generate`, { method: "POST" });
}

/** The wizard screen for one of the server's step names (e.g. "act1.feeling" or "gate"). */
export function routeForStep(step: string): string {
  const act = /^act([123])(?:\.(obstacle|feeling|move))?$/.exec(step);
  if (act) return act[2] ? `/story/act/${act[1]}/${act[2]}` : actStart(Number(act[1]) as 1 | 2 | 3, "senior");
  return (ROUTES as Record<string, string>)[step] ?? ROUTES.author;
}

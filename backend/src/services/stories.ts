import { isValidObjectId } from "mongoose";
import { Child, Story } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import type { StoryPatch } from "../types/story.js";
import { assertStatusChange } from "./storyLifecycle.js";
import { changesForSave, missingSteps } from "./storyRules.js";
import { storySummary } from "./storyViews.js";

// Story drafts and the wizard (guide BE-08).
//
// Who is asking decides which stories they can reach:
//   - a child session: only stories of ITS child
//   - a parent: only stories of THEIR children (not removed ones)
// Anything else looks like it doesn't exist: 404.

export type StoryActor = { kind: "child"; childId: string } | { kind: "parent"; parentId: string };

const notFound = () => new AppError(404, "NOT_FOUND", "Story not found");

// The child ids this actor may see.
async function reachableChildIds(actor: StoryActor): Promise<string[]> {
  if (actor.kind === "child") return [actor.childId];
  const children = await Child.find({ parentId: actor.parentId, deletedAt: null }, { _id: 1 }).lean();
  return children.map((c) => String(c._id));
}

// One story this actor may reach, or 404.
async function findReachableStory(actor: StoryActor, storyId: string) {
  // Check the id first: a nonsense id would make MongoDB throw (a 500).
  if (!isValidObjectId(storyId)) throw notFound();
  const story = await Story.findOne({ _id: storyId, childId: { $in: await reachableChildIds(actor) } });
  if (!story) throw notFound();
  return story;
}

// POST /stories: a new, empty draft for the child in this session. The mode is copied from
// the child's profile now and stays with the story, even if the parent changes it later.
export async function createDraft(childId: string, input: { authorName?: string }) {
  const child = await Child.findOne({ _id: childId, deletedAt: null }).lean();
  if (!child) throw new AppError(404, "NOT_FOUND", "Child not found");
  const story = await Story.create({ childId, mode: child.mode, ...input });
  return story.toJSON();
}

// GET /stories: summaries (no story text), newest first. A parent can filter to one child.
export async function listStories(actor: StoryActor, onlyChildId?: string) {
  let childIds = await reachableChildIds(actor);
  if (onlyChildId !== undefined) {
    if (!childIds.includes(onlyChildId)) throw new AppError(404, "NOT_FOUND", "Child not found");
    childIds = [onlyChildId];
  }
  const stories = await Story.find({ childId: { $in: childIds } }).sort({ updatedAt: -1 }).lean();
  return stories.map(storySummary);
}

// GET /stories/:id: every field, so a reopened draft restores everything (defect 1).
export async function getStory(actor: StoryActor, storyId: string) {
  return (await findReachableStory(actor, storyId)).toJSON();
}

// PATCH /stories/:id: save one wizard step. Only the child, only while it's a draft.
export async function saveStep(childId: string, storyId: string, patch: StoryPatch) {
  const story = await findReachableStory({ kind: "child", childId }, storyId);
  if (story.status !== "draft") {
    // After generation, changes go through the review routes (BE-12) instead.
    throw new AppError(409, "STORY_NOT_DRAFT", "This story can't be changed here any more");
  }
  story.set(changesForSave(story.mode, story, patch));
  await story.save();
  return story.toJSON();
}

// POST /stories/:id/generate: generation starts only from a complete draft (defect 2).
export async function startGeneration(childId: string, storyId: string): Promise<never> {
  const story = await findReachableStory({ kind: "child", childId }, storyId);
  // Only a draft can start generating (409 otherwise).
  assertStatusChange(story.status, "generating");

  const missing = missingSteps(story.mode, story);
  if (missing.length > 0) {
    throw new AppError(400, "STORY_INCOMPLETE", "Some story steps aren't finished yet", { missingSteps: missing });
  }
  // Decision 3A: the job queue arrives in BE-07. Until then the story stays a draft, so
  // nothing gets stuck in "generating" with no worker to finish it.
  throw new AppError(503, "GENERATION_NOT_READY", "Story generation isn't switched on yet");
}

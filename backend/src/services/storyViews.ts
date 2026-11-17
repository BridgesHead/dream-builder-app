import { isValidObjectId } from "mongoose";
import { Child, FacilitatorLink, Story } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import { writeAudit } from "./audit.js";
import { toPublicChild } from "./children.js";

// Read-only story access for facilitators and admins (guide BE-05).
// Nothing in here changes a story: facilitators only ever READ.
// Opening a story writes one "story.view" audit entry; lists don't (they show no story text).

const notFound = (what: string) => new AppError(404, "NOT_FOUND", `${what} not found`);

// One row of the FE-14 portal story history: no story text, just what the list needs.
function storySummary(story: {
  _id: unknown;
  childId: unknown;
  title?: string | null;
  status: string;
  mode: string;
  storyPath?: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: String(story._id),
    childId: String(story.childId),
    title: story.title ?? null,
    status: story.status,
    mode: story.mode,
    storyPath: story.storyPath ?? null,
    createdAt: story.createdAt,
    updatedAt: story.updatedAt,
  };
}

// ---- Facilitator: only children linked to them (and not removed by their parent) ----

async function linkedChildIds(facilitatorId: string): Promise<string[]> {
  const links = await FacilitatorLink.find({ facilitatorId }).lean();
  return links.map((l) => String(l.childId));
}

async function assertLinked(facilitatorId: string, childId: string): Promise<void> {
  if (!isValidObjectId(childId)) throw notFound("Child");
  const linked = await FacilitatorLink.exists({ facilitatorId, childId });
  const child = linked && (await Child.exists({ _id: childId, deletedAt: null }));
  // Not linked looks exactly like "doesn't exist": 404.
  if (!child) throw notFound("Child");
}

export async function facilitatorChildren(facilitatorId: string) {
  const ids = await linkedChildIds(facilitatorId);
  const children = await Child.find({ _id: { $in: ids }, deletedAt: null }).sort({ name: 1 }).lean();
  return children.map(toPublicChild);
}

export async function facilitatorStoryHistory(facilitatorId: string, childId: string) {
  await assertLinked(facilitatorId, childId);
  const stories = await Story.find({ childId }).sort({ updatedAt: -1 }).lean();
  return stories.map(storySummary);
}

export async function facilitatorViewStory(facilitatorId: string, storyId: string, ip?: string) {
  if (!isValidObjectId(storyId)) throw notFound("Story");
  const story = await Story.findById(storyId);
  if (!story) throw notFound("Story");
  await assertLinked(facilitatorId, String(story.childId)).catch(() => {
    throw notFound("Story");
  });
  await writeAudit({ actorId: facilitatorId, actorRole: "facilitator", action: "story.view", targetType: "story", targetId: storyId, ipAddress: ip });
  return story.toJSON();
}

// ---- Admin: any story ----

export async function adminViewStory(adminId: string, storyId: string, ip?: string) {
  if (!isValidObjectId(storyId)) throw notFound("Story");
  const story = await Story.findById(storyId);
  if (!story) throw notFound("Story");
  await writeAudit({ actorId: adminId, actorRole: "admin", action: "story.view", targetType: "story", targetId: storyId, ipAddress: ip });
  return story.toJSON();
}

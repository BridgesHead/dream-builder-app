import { isValidObjectId, type Types } from "mongoose";
import { Child } from "../db/models/index.js";
import { AppError } from "../lib/errors.js";
import type { Mode } from "../types/story.js";
import { writeAudit } from "./audit.js";

// Child profiles (guide BE-04). The golden rule: EVERY query includes
// { parentId: <the logged-in parent> }, so a parent can only ever reach their own children.
// Someone else's child, a removed child and a nonsense id all look the same: 404.

// The only shape of a child that leaves the server. Field names follow the frontend's
// ChildProfile, plus mode.
export interface PublicChild {
  id: string;
  name: string;
  age: number;
  language: string;
  mode: Mode;
}

interface ChildLike {
  _id: Types.ObjectId;
  name: string;
  age: number;
  language: string;
  mode: Mode;
}

export function toPublicChild(child: ChildLike): PublicChild {
  return { id: String(child._id), name: child.name, age: child.age, language: child.language, mode: child.mode };
}

export interface NewChild {
  name: string;
  age: number;
  language: string;
  // Missing = default from age (under 12 Explorer, 12+ Creator). Given = the parent's choice.
  mode?: Mode;
}
export type ChildChanges = Partial<NewChild>;

const notFound = () => new AppError(404, "NOT_FOUND", "Child not found");

// Finds one of THIS parent's children, or throws 404.
async function findOwnChild(parentId: string, childId: string) {
  // Check the id first: a nonsense id would make MongoDB throw, which would be a 500.
  if (!isValidObjectId(childId)) throw notFound();
  const child = await Child.findOne({ _id: childId, parentId, deletedAt: null });
  if (!child) throw notFound();
  return child;
}

export async function listChildren(parentId: string): Promise<PublicChild[]> {
  const children = await Child.find({ parentId, deletedAt: null }).sort({ createdAt: 1 }).lean();
  return children.map(toPublicChild);
}

export async function getChild(parentId: string, childId: string): Promise<PublicChild> {
  return toPublicChild(await findOwnChild(parentId, childId));
}

export async function createChild(parentId: string, input: NewChild, ip?: string): Promise<PublicChild> {
  // parentId comes from the login, never from the request body.
  const child = await Child.create({ ...input, parentId });
  await writeAudit({ actorId: parentId, actorRole: "parent", action: "child.create", targetType: "child", targetId: String(child._id), ipAddress: ip });
  return toPublicChild(child);
}

export async function updateChild(parentId: string, childId: string, changes: ChildChanges, ip?: string): Promise<PublicChild> {
  const child = await findOwnChild(parentId, childId);
  // If only the age changes, the stored mode stays: it's the parent's choice (decision 5A).
  child.set(changes);
  await child.save();
  await writeAudit({ actorId: parentId, actorRole: "parent", action: "child.update", targetType: "child", targetId: childId, ipAddress: ip });
  return toPublicChild(child);
}

// Removing a child is now a full deletion with the parent's password (BE-16): see
// services/deletion.ts and POST /children/:id/deletion.

// Child profile calls to the Dream Builder API (backend BE-04). Parent only.
import { api } from "./api";

export type Mode = "junior" | "senior";

/** A child profile as the server describes it. */
export interface ServerChild {
  id: string;
  name: string;
  age: number;
  language: string;
  /** Explorer (junior) or Creator (senior): the parent's choice, stored on the server. */
  mode: Mode;
}

export async function listChildren(): Promise<ServerChild[]> {
  return (await api<{ children: ServerChild[] }>("/children")).children;
}

export async function addChild(input: { name: string; age: number; language: string; mode: Mode }): Promise<ServerChild> {
  return (await api<{ child: ServerChild }>("/children", { method: "POST", body: input })).child;
}

// ---- Deleting a child's data (backend BE-16) ----------------------------------------------

/** What deleting this child removes, what is kept, and whether a printed book is still on its way. */
export interface DeletionPreview {
  child: { id: string; name: string };
  willDelete: { stories: number; comments: number; files: number; aiRecords: number };
  kept: string[];
  waitsForPrint: boolean;
}

export interface DeletionRequest {
  id: string;
  childId: string;
  status: "queued" | "waiting_for_print" | "running" | "done" | "failed";
  requestedAt: string;
  finishedAt: string | null;
}

export async function getDeletionPreview(id: string): Promise<DeletionPreview> {
  return api<DeletionPreview>(`/children/${encodeURIComponent(id)}/deletion-preview`);
}

/**
 * Deletes the child's data (needs the parent's password). The child disappears at once; the
 * server deletes everything in the background and emails the parent when it's done.
 */
export async function requestDeletion(id: string, password: string): Promise<{ request: DeletionRequest; waitsForPrint: boolean }> {
  return api(`/children/${encodeURIComponent(id)}/deletion`, { method: "POST", body: { password } });
}

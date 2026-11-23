// Child profile calls to the Dream Builder API (backend BE-04). Parent only.
import { api } from "./api";

import type * as Api from "@dream-builder/api-types";

/** Explorer (junior) or Creator (senior). */
export type Mode = Api.Mode;

/** A child profile as the server describes it (from the API contract, openapi.yaml). */
export type ServerChild = Api.Child;

export async function listChildren(): Promise<ServerChild[]> {
  return (await api<{ children: ServerChild[] }>("/children")).children;
}

export async function addChild(input: { name: string; age: number; language: string; mode: Mode }): Promise<ServerChild> {
  return (await api<{ child: ServerChild }>("/children", { method: "POST", body: input })).child;
}

// ---- Deleting a child's data (backend BE-16) ----------------------------------------------

/** What deleting this child removes, what is kept, and whether a printed book is still on its way. */
export type DeletionPreview = Api.DeletionPreview;

export type DeletionRequest = Api.DeletionRequest;

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

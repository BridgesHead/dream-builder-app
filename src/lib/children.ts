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

/** Hides the profile (the server keeps it until the full deletion workflow) and ends their sessions. */
export function removeChild(id: string): Promise<void> {
  return api(`/children/${encodeURIComponent(id)}`, { method: "DELETE" });
}

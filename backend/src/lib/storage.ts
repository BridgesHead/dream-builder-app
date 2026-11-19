import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { config } from "../config.js";

// Where pictures live (guide BE-10): OUR storage, never fal.ai links.
//
//   S3_BUCKET set      → the S3 bucket in the AWS UAE region (dev, staging, production)
//   S3_BUCKET not set  → a local folder (data/storage), for your PC only
//
// The story only stores the picture's KEY, e.g. "stories/665f…/panel-03.png". When the app
// needs to show it, it gets a short-lived signed link (decision 4A): S3 signs it itself; for
// the local folder our API signs it and serves the file at /api/v1/media/<key>.

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};
const TYPE_OF_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

// Keys are made by our code only, but checked anyway so a key can never reach outside
// the storage folder ("../").
const KEY_PATTERN = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_.-]*)+$/i;
export const isSafeKey = (key: string) => KEY_PATTERN.test(key) && !key.includes("..");

function checkKey(key: string): void {
  if (!isSafeKey(key)) throw new Error("Invalid storage key");
}

/** The key for one panel's picture, e.g. "stories/665f…/panel-03.png". */
export const panelImageKey = (storyId: string, panelNumber: number, ext: string) =>
  `stories/${storyId}/panel-${String(panelNumber).padStart(2, "0")}.${ext}`;

/**
 * The key for a REDRAWN picture (BE-12), e.g. "stories/665f…/panel-03-r6660….png". A new key
 * per redraw job, so the old picture is never overwritten until the new one is ready.
 */
export const panelRedrawKey = (storyId: string, panelNumber: number, jobId: string, ext: string) =>
  `stories/${storyId}/panel-${String(panelNumber).padStart(2, "0")}-r${jobId}.${ext}`;

export interface SignedLink {
  url: string;
  expiresAt: Date;
}

export interface Storage {
  kind: "s3" | "local";
  save(key: string, body: Uint8Array, contentType: string): Promise<void>;
  link(key: string): Promise<SignedLink>;
}

// ---- S3 (the UAE bucket) ----------------------------------------------------------------

export function s3Storage(bucket: string): Storage {
  // Credentials come from the server's IAM role (AWS) or the usual AWS env vars.
  const client = new S3Client({ region: config.storage.region });
  return {
    kind: "s3",
    async save(key, body, contentType) {
      checkKey(key);
      await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
    },
    async link(key) {
      checkKey(key);
      const seconds = config.storage.urlTtlSeconds;
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: seconds });
      return { url, expiresAt: new Date(Date.now() + seconds * 1000) };
    },
  };
}

// ---- The local folder (your PC) --------------------------------------------------------

const root = () => path.resolve(config.storage.dir);
// The signing key is made from the access-token secret, labelled so the two can never be swapped.
const signature = (key: string, expires: number) =>
  createHmac("sha256", `media-links:${config.jwtAccessSecret}`).update(`${key}\n${expires}`).digest("base64url");

const localStorage: Storage = {
  kind: "local",
  async save(key, body) {
    checkKey(key);
    const file = path.join(root(), key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  },
  async link(key) {
    checkKey(key);
    const expires = Math.floor(Date.now() / 1000) + config.storage.urlTtlSeconds;
    const url = `${config.storage.apiUrl}/api/v1/media/${key}?expires=${expires}&sig=${signature(key, expires)}`;
    return { url, expiresAt: new Date(expires * 1000) };
  },
};

/**
 * For the /api/v1/media route: the file, if the link's signature is right and it hasn't
 * expired. null otherwise (the route answers 404 either way, so nothing is revealed).
 */
export async function readSignedLocal(key: string, expires: string, sig: string): Promise<{ body: Buffer; contentType: string } | null> {
  if (!isSafeKey(key) || !/^\d{1,12}$/.test(expires)) return null;
  const when = Number(expires);
  if (when < Date.now() / 1000) return null;
  const expected = Buffer.from(signature(key, when));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const contentType = TYPE_OF_EXT[key.split(".").pop() ?? ""];
  if (!contentType) return null;
  try {
    return { body: await readFile(path.join(root(), key)), contentType };
  } catch {
    return null;
  }
}

let storage: Storage | null = null;

export function getStorage(): Storage {
  storage ??= config.storage.bucket ? s3Storage(config.storage.bucket) : localStorage;
  return storage;
}

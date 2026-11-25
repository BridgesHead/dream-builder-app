import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { DeleteObjectsCommand, GetObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
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
const TYPE_OF_EXT: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp", pdf: "application/pdf" };

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

/**
 * The key for a book PDF (BE-18), inside the story's folder so a deletion (BE-16) removes it too:
 * "stories/665f…/print/<orderId>-download.pdf" (the parent's copy) or "…-print.pdf" (the printer's).
 */
export const bookPdfKey = (storyId: string, orderId: string, kind: "download" | "print") => `stories/${storyId}/print/${orderId}-${kind}.pdf`;

/** The key for one comic cell's picture (BE-11), e.g. "stories/665f…/cell-07.png". */
export const comicCellKey = (storyId: string, cellNumber: number, ext: string) =>
  `stories/${storyId}/cell-${String(cellNumber).padStart(2, "0")}.${ext}`;

export interface LinkOptions {
  /** Makes the browser save the file under this name instead of opening it. */
  downloadName?: string;
}

/** A file name safe for a Content-Disposition header: letters, digits, "-" and "_" only. */
export const safeFileName = (name: string) => name.normalize("NFKD").replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "story";

export interface SignedLink {
  url: string;
  expiresAt: Date;
}

export interface Storage {
  kind: "s3" | "local";
  save(key: string, body: Uint8Array, contentType: string): Promise<void>;
  link(key: string, options?: LinkOptions): Promise<SignedLink>;
  /** A file's bytes (BE-18 reads the pictures back to put them in the PDF). */
  read(key: string): Promise<Uint8Array>;
  /** How many files are in a folder, e.g. "stories/665f…/" (BE-16). */
  countFolder(prefix: string): Promise<number>;
  /** Deletes every file in a folder; returns how many. Deleting an empty folder is fine (BE-16). */
  removeFolder(prefix: string): Promise<number>;
}

/** The folder of everything one story owns: pictures, redraws, and later voice and print files. */
export const storyFolder = (storyId: string) => `stories/${storyId}/`;

// A folder is always "<safe key>/": never the whole bucket, never "../".
function checkFolder(prefix: string): void {
  if (!prefix.endsWith("/") || !isSafeKey(`${prefix}x`)) throw new Error("Invalid storage folder");
}

/** Tests only: the next N folder deletes fail, to check the deletion job retries (BE-16). */
export const storageFaults = { removeFailures: 0 };
function maybeFail(): void {
  if (storageFaults.removeFailures > 0) {
    storageFaults.removeFailures -= 1;
    throw new Error("Storage delete failed on purpose (test)");
  }
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
    async link(key, options = {}) {
      checkKey(key);
      const seconds = config.storage.urlTtlSeconds;
      const disposition = options.downloadName ? `attachment; filename="${safeFileName(options.downloadName)}.pdf"` : undefined;
      const url = await getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: disposition }), { expiresIn: seconds });
      return { url, expiresAt: new Date(Date.now() + seconds * 1000) };
    },
    async read(key) {
      checkKey(key);
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error("Empty file in storage");
      return res.Body.transformToByteArray();
    },
    async countFolder(prefix) {
      checkFolder(prefix);
      return (await listKeys(prefix)).length;
    },
    async removeFolder(prefix) {
      checkFolder(prefix);
      maybeFail();
      const keys = await listKeys(prefix);
      // At most 1000 keys per delete call (S3's limit).
      for (let i = 0; i < keys.length; i += 1000) {
        const batch = keys.slice(i, i + 1000).map((Key) => ({ Key }));
        const res = await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: batch, Quiet: true } }));
        if (res.Errors?.length) throw new Error(`S3 could not delete ${res.Errors.length} file(s)`);
      }
      return keys.length;
    },
  };

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }));
      for (const o of page.Contents ?? []) if (o.Key) keys.push(o.Key);
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }
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
  async link(key, options = {}) {
    checkKey(key);
    const expires = Math.floor(Date.now() / 1000) + config.storage.urlTtlSeconds;
    const name = options.downloadName ? `&download=${encodeURIComponent(safeFileName(options.downloadName))}` : "";
    const url = `${config.storage.apiUrl}/api/v1/media/${key}?expires=${expires}&sig=${signature(key, expires)}${name}`;
    return { url, expiresAt: new Date(expires * 1000) };
  },
  async read(key) {
    checkKey(key);
    return readFile(path.join(root(), key));
  },
  async countFolder(prefix) {
    checkFolder(prefix);
    return (await localFiles(path.join(root(), prefix))).length;
  },
  async removeFolder(prefix) {
    checkFolder(prefix);
    maybeFail();
    const dir = path.join(root(), prefix);
    const count = (await localFiles(dir)).length;
    await rm(dir, { recursive: true, force: true });
    return count;
  },
};

/** Every file under a local folder (none if it doesn't exist). */
async function localFiles(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true, recursive: true });
    return entries.filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
  } catch {
    return [];
  }
}

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

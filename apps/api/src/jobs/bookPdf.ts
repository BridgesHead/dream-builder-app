import { isValidObjectId } from "mongoose";
import { config } from "../config.js";
import { Order, Story, type PdfStatus } from "../db/models/index.js";
import { BUBBLES, COMIC_CELL_COUNT, comicPlanFor, LAYOUTS, type Bubble, type ComicLayout } from "../engine/comicPlan.js";
import { planFor } from "../engine/plan.js";
import { HERO_DEFAULT_NAMES } from "../engine/tables.js";
import { logger } from "../lib/logger.js";
import { bookPdfKey, getStorage } from "../lib/storage.js";
import { getPrintProfile } from "../print/profiles.js";
import { renderBook, type BookContent, type BookPanel, type ComicPage } from "../print/renderBook.js";
import { writeAudit } from "../services/audit.js";
import { PANEL_COUNT, type StoryPath } from "../types/story.js";
import { BOOK_PDF_JOB_PREFIX, enqueueJob, type Attempt } from "./queue.js";

// The book PDF job (guide BE-18). Runs on the queue after Stripe says an order is paid.
//
//   order paid → queueBookPdf → [worker] runBookPdf:
//     read the story and its pictures from OUR storage
//     → the parent's PDF (DOWNLOAD_PROFILE, "digital": no bleed)
//     → a hardback also gets the printer's file (PRINT_PROFILE, "generic" until the publisher's spec)
//     → both saved under stories/<storyId>/print/ (so a BE-16 deletion removes them)
//     → the order says pdfStatus "ready"; a hardback's printStatus moves waiting → file_ready
//
// Safe to run twice: the files are saved under the same keys each time, so a retry overwrites
// its own work.

const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

class Timeout extends Error {}
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`Took longer than ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

/** Puts a paid order's PDF on the queue. `again` = make it again even if it's ready (admin script). */
export async function queueBookPdf(orderId: string, options: { again?: boolean } = {}): Promise<boolean> {
  // null: an order paid before BE-18 existed has no pdfStatus yet.
  const from: (PdfStatus | null)[] = options.again ? [null, "not_started", "queued", "making", "ready", "failed"] : [null, "not_started", "failed"];
  const moved = await Order.updateOne({ _id: orderId, paymentStatus: "paid", pdfStatus: { $in: from } }, { $set: { pdfStatus: "queued", pdfError: null } });
  if (moved.matchedCount === 0) return false;
  // A new key per request, so "make it again" isn't ignored as a repeat.
  await enqueueJob(`${BOOK_PDF_JOB_PREFIX}${orderId}`, `${BOOK_PDF_JOB_PREFIX}${orderId}-${Date.now()}`);
  return true;
}

/** The parts of a saved story the book needs. */
export interface StoryForBook {
  title?: string | null;
  charName?: string | null;
  heroType?: string | null;
  /** "junior" (Explorer) or "senior" (Creator). */
  mode?: string | null;
  authorName?: string | null;
  aspiration?: string | null;
  oneMoreAmazingThing?: string | null;
  storyGeneratedAt?: Date | null;
  approvedAt?: Date | null;
  createdAt: Date;
  storyPath?: string | null;
  panels: { number: number; text?: string | null; imageKey?: string | null }[];
  /** "comic" makes a comic book from comicCells (BE-11). */
  selectedFormat?: string | null;
  comicCells?: { page: number; cell: number; caption?: string | null; dialogue?: string | null; bubbleType?: string | null; tempo?: string | null; sfx?: string | null; layout?: string | null; imageKey?: string | null }[];
}

const capitalise = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** The story's words and pictures, as renderBook needs them. Only the chosen path's panels. */
export async function bookContentOf(story: StoryForBook): Promise<BookContent> {
  const path = story.storyPath as StoryPath | null;
  if (!path) throw new Error("The story has no path (two_act or three_act)");
  const expected = PANEL_COUNT[path];
  // A two-act book is exactly panels 1–12: never an Act 3 panel, never a gap.
  const panels = [...story.panels].filter((p) => p.number <= expected).sort((a, b) => a.number - b.number);
  if (panels.length !== expected || panels.some((p, i) => p.number !== i + 1)) {
    throw new Error(`The story has ${panels.length} of its ${expected} panels`);
  }
  const storage = getStorage();
  const read = async (key: string | null | undefined) => {
    if (!key) return null;
    try {
      return await storage.read(key);
    } catch {
      return null; // shown as the hero + a warning on the order
    }
  };
  // The panel names the website shows ("Identity Anchor", …), from the story plan (BE-09).
  const labels = planFor(path).map((p) => p.label);
  const withPictures: BookPanel[] = [];
  for (const p of panels) {
    let image: Uint8Array | null = null;
    if (p.imageKey) {
      try {
        image = await storage.read(p.imageKey);
      } catch {
        image = null; // shown as a frame + a warning on the order
      }
    }
    withPictures.push({ number: p.number, label: labels[p.number - 1] ?? `Page ${p.number}`, text: p.text ?? "", image });
  }
  const heroName = capitalise((story.charName ?? "").trim()) || (HERO_DEFAULT_NAMES as Record<string, string>)[story.heroType ?? ""] || "Sparky";
  return {
    title: story.title?.trim() || `${heroName}'s Story`,
    heroName,
    heroType: (["fox", "robot", "knight"] as const).find((h) => h === story.heroType) ?? null,
    edition: story.mode === "senior" ? "Creator" : "Explorer",
    authorName: story.authorName ?? "",
    // When the story was written, NOT today (guide BE-18).
    writtenOn: story.storyGeneratedAt ?? story.approvedAt ?? story.createdAt,
    aspiration: story.aspiration ?? "",
    oneMoreAmazingThing: story.oneMoreAmazingThing ?? "",
    panels: withPictures,
    comic: story.selectedFormat === "comic" ? await comicPagesOf(story, path, read) : undefined,
  };
}

/** A comic's pages (BE-11): every page with its 4 cells, or an error if the comic isn't complete. */
async function comicPagesOf(story: StoryForBook, path: StoryPath, read: (key: string | null | undefined) => Promise<Uint8Array | null>): Promise<ComicPage[]> {
  const cells = story.comicCells ?? [];
  if (cells.length !== COMIC_CELL_COUNT[path]) throw new Error(`The comic has ${cells.length} of its ${COMIC_CELL_COUNT[path]} cells`);
  const pages: ComicPage[] = [];
  for (const plan of comicPlanFor(path)) {
    const onPage = cells.filter((c) => c.page === plan.page).sort((a, b) => a.cell - b.cell);
    pages.push({
      page: plan.page,
      // Never the story's inner labels ("First Pivot") on a page: the running head is the title.
      label: "",
      // The page's own arrangement; comics made before the layouts get the plan's.
      layout: (LAYOUTS as readonly string[]).includes(onPage[0]?.layout ?? "") ? (onPage[0].layout as ComicLayout) : plan.layout,
      cells: await Promise.all(
        onPage.map(async (c) => ({
          caption: c.caption ?? "",
          dialogue: c.dialogue ?? null,
          bubbleType: (BUBBLES as readonly string[]).includes(c.bubbleType ?? "") ? (c.bubbleType as Bubble) : "none",
          tempo: c.tempo ?? null,
          sfx: c.sfx ?? null,
          image: await read(c.imageKey),
        })),
      ),
    });
  }
  return pages;
}

/** One try of one order's PDF. Throwing tells the queue the try failed (it retries). */
export async function runBookPdf(orderId: string, { isLastAttempt }: Attempt): Promise<void> {
  if (!isValidObjectId(orderId)) return;
  // Claim it. Already ready or not paid (e.g. delivered twice)? Nothing to do.
  const order = await Order.findOneAndUpdate(
    { _id: orderId, paymentStatus: "paid", pdfStatus: { $in: ["queued", "making"] } },
    { $set: { pdfStatus: "making" }, $inc: { pdfAttempts: 1 } },
    { returnDocument: "after" },
  );
  if (!order) return;

  try {
    await withTimeout(
      (async () => {
        const story = await Story.findById(order.storyId).lean();
        if (!story) throw new Error("The story is gone");
        const content = await bookContentOf(story);
        const storyId = String(story._id);
        const storage = getStorage();

        // The parent's copy.
        const download = await renderBook(content, getPrintProfile(config.print.downloadProfile));
        const pdfKey = bookPdfKey(storyId, orderId, "download");
        await storage.save(pdfKey, download.pdf, "application/pdf");

        // The printer's file (hardback only).
        let printFileKey: string | null = null;
        let printed = download;
        if (order.tier === "hardback") {
          printed = await renderBook(content, getPrintProfile(config.print.printProfile));
          printFileKey = bookPdfKey(storyId, orderId, "print");
          await storage.save(printFileKey, printed.pdf, "application/pdf");
        }
        // Warnings that matter for the book being bought: the print file's for a hardback.
        const warnings = [...new Set(order.tier === "hardback" ? printed.warnings : download.warnings)].slice(0, 40);

        await Order.updateOne(
          { _id: order._id },
          {
            $set: {
              pdfStatus: "ready",
              pdfKey,
              printFileKey,
              printProfile: order.tier === "hardback" ? config.print.printProfile : config.print.downloadProfile,
              pageCount: printed.pageCount,
              pdfWarnings: warnings,
              pdfError: null,
              pdfReadyAt: new Date(),
            },
          },
        );
        // A hardback's file is ready for the publisher (BE-19 sends it).
        if (order.tier === "hardback") await Order.updateOne({ _id: order._id, printStatus: "waiting" }, { $set: { printStatus: "file_ready" } });
        await writeAudit({ actorId: null, actorRole: "system", action: "order.pdf_ready", targetType: "order", targetId: orderId });
        logger.info({ orderId, tier: order.tier, pages: printed.pageCount, warnings: warnings.length }, "Book PDF ready");
      })(),
      config.print.timeoutMs,
    );
  } catch (err) {
    const reason = reasonOf(err);
    logger.warn({ orderId, isLastAttempt, reason }, "Book PDF try failed");
    await Order.updateOne({ _id: order._id }, { $set: { pdfStatus: isLastAttempt ? "failed" : "queued", pdfError: reason } });
    throw err; // the queue retries
  }
}

/**
 * At startup (API in memory mode, and every worker): puts unfinished PDFs back on the list (a
 * restart forgets the in-memory list), and starts the PDF of any paid order that never got one
 * (paid before BE-18 existed, or the queue was down when the payment arrived).
 */
export async function recoverBookPdfs(): Promise<void> {
  const open = await Order.find({ paymentStatus: "paid", pdfStatus: { $in: ["queued", "making"] } }, { _id: 1 }).lean();
  for (const o of open) await enqueueJob(`${BOOK_PDF_JOB_PREFIX}${String(o._id)}`, `${BOOK_PDF_JOB_PREFIX}${String(o._id)}-recover-${Date.now()}`);
  const never = await Order.find({ paymentStatus: "paid", pdfStatus: { $in: [null, "not_started"] } }, { _id: 1 }).lean();
  for (const o of never) await queueBookPdf(String(o._id));
  if (open.length + never.length > 0) logger.info({ unfinished: open.length, neverStarted: never.length }, "Put book PDFs on the list");
}

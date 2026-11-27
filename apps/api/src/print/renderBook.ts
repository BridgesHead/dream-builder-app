import { readFileSync } from "node:fs";
import PDFDocument from "pdfkit";
import type { Bubble, ComicLayout } from "../engine/comicPlan.js";
import type { PrintProfile } from "./profiles.js";

// Draws one storybook as a PDF (guide BE-18), in the SAME design as the book on the website
// (apps/web/src/components/Flipbook.tsx), but as ordinary single pages, one after another:
//
//   1  the cover            purple board, gold frame, ribbon, edition, title, "by …", the hero, the date written
//   2  "This book belongs to"  the inside cover (dotted endpaper)
//   3  the title page        "A Dream Builder Story", title, the hero in a circle, "Written by …"
//   4  Today's Mission       the child's dream
//   5… the story            each panel opens a new page: picture, panel name, ornament, text with a
//                           drop capital. A long text carries on to the next page, like the website.
//      (a comic, BE-11)     instead: one page per comic page, 4 cells in a 2×2 grid, each with its
//                           picture, a caption box, a speech or thought bubble, and Tempo's notes
//      (fillers)            "My drawing" pages, only if the profile needs a page-count multiple
//      The End              the hero resting, "Thank you for reading …"
//      the back cover       purple board, "Made with Dream Builder" (the voice QR goes here later, BE-15)
//
// No database, storage or HTTP here: it gets the words and pictures and a print profile, and
// gives back the PDF's bytes. Every size comes from the profile. Text and pictures stay inside
// the safe margin; only background colour runs into the bleed.

export type HeroType = "fox" | "robot" | "knight";

export interface BookPanel {
  number: number;
  /** The panel's name on the website, e.g. "Identity Anchor". */
  label: string;
  text: string;
  /** The picture's bytes (PNG or JPEG), or null if it's missing. */
  image: Uint8Array | null;
}

export interface BookContent {
  title: string;
  heroName: string;
  heroType: HeroType | null;
  authorName: string;
  /** "Explorer" (under 12) or "Creator": printed on the cover, like the website. */
  edition: "Explorer" | "Creator";
  /** When the story was written: shown on the cover (NOT the day the PDF is made). */
  writtenOn: Date;
  aspiration: string;
  oneMoreAmazingThing: string;
  panels: BookPanel[];
  /** A comic (BE-11): its pages replace the panel pages. */
  comic?: ComicPage[];
}

export interface ComicCellContent {
  caption: string;
  dialogue: string | null;
  bubbleType: Bubble;
  /** Tempo's bubble: music notation only (drawn as notes). */
  tempo: string | null;
  /** A sound effect drawn on the picture, e.g. "WHOOSH!". */
  sfx?: string | null;
  image: Uint8Array | null;
}

export interface ComicPage {
  page: number;
  /** The running head on right-hand pages ("" = the book's title). */
  label: string;
  /** How the 4 panels are arranged (comicPlan.ts LAYOUTS). */
  layout?: ComicLayout;
  cells: ComicCellContent[];
}

export interface RenderedBook {
  pdf: Buffer;
  pageCount: number;
  /** Problems worth showing admin, e.g. a picture below the profile's dpi. Never fatal. */
  warnings: string[];
}

const PT_PER_MM = 72 / 25.4;
const mm = (v: number) => v * PT_PER_MM;

// The website's colours (apps/web/tailwind.config.js, index.css, Flipbook.tsx).
const COL = {
  ink: "#14142B",
  inkMuted: "#5F6275",
  inkFaint: "#9A9CAE",
  brand: "#5B3CD1",
  board: "#4A2FB5",
  paper: "#FCFAF4",
  endpaper: "#EEEAFB",
  amber200: "#FDE68A",
  amber400: "#FBBF24",
  amber600: "#D97706",
  amber700: "#B45309",
  amber800: "#92400E",
  pill: "#3B24A0",
};

// ---- Fonts and pictures that come with the API (apps/api/assets) -------------------------
// Fraunces (book text) and Nunito (labels): the website's fonts, SIL Open Font License.
const ASSETS = new URL("../../assets/", import.meta.url);
const asset = (p: string) => readFileSync(new URL(p, ASSETS));
// ---- Comic page arrangements (BE-11) ----------------------------------------------------
// Each panel's place on the page as [x, y, width, height], fractions of the page's text area.
// The panel order and shapes match comicPlan.ts PANEL_SHAPES.
const COMIC_FRAMES: Record<ComicLayout, [number, number, number, number][]> = {
  big_top: [[0, 0, 1, 0.56], [0, 0.56, 1 / 3, 0.44], [1 / 3, 0.56, 1 / 3, 0.44], [2 / 3, 0.56, 1 / 3, 0.44]],
  big_bottom: [[0, 0, 1 / 3, 0.44], [1 / 3, 0, 1 / 3, 0.44], [2 / 3, 0, 1 / 3, 0.44], [0, 0.44, 1, 0.56]],
  tall: [[0, 0, 0.42, 1], [0.42, 0, 0.58, 0.5], [0.42, 0.5, 0.29, 0.5], [0.71, 0.5, 0.29, 0.5]],
  grid: [[0, 0, 0.5, 0.5], [0.5, 0, 0.5, 0.5], [0, 0.5, 0.5, 0.5], [0.5, 0.5, 0.5, 0.5]],
};

const FONT_FILES = {
  Display: "fonts/fraunces-latin-500-normal.woff",
  DisplayItalic: "fonts/fraunces-latin-500-italic.woff",
  DisplayBold: "fonts/fraunces-latin-600-normal.woff",
  DisplayBoldItalic: "fonts/fraunces-latin-600-italic.woff",
  Sans: "fonts/nunito-latin-600-normal.woff",
  SansBold: "fonts/nunito-latin-700-normal.woff",
  SansHeavy: "fonts/nunito-latin-800-normal.woff",
} as const;
type FontName = keyof typeof FONT_FILES;
let fontCache: Record<FontName, Buffer> | null = null;
const fonts = () => (fontCache ??= Object.fromEntries(Object.entries(FONT_FILES).map(([k, f]) => [k, asset(f)])) as Record<FontName, Buffer>);

const heroCache = new Map<string, Buffer | null>();
/** The website's hero art (avatar, standing, breathe), or null if it's not there. */
function heroPicture(hero: HeroType | null, pose: "avatar" | "standing" | "breathe"): Buffer | null {
  const key = `${hero ?? "fox"}/${pose}`;
  if (!heroCache.has(key)) {
    try {
      heroCache.set(key, asset(`heroes/${key}.png`));
    } catch {
      heroCache.set(key, null);
    }
  }
  return heroCache.get(key)!;
}

/** "25 November 2026", in UAE time. */
export const formatWrittenDate = (d: Date) =>
  d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Dubai" });

/** Pictures narrower than this are the stub AI's placeholder (a 1×1 PNG), like the website. */
const PLACEHOLDER_MAX_WIDTH = 16;

// pdfkit has openImage at runtime, but its types don't list it.
interface PdfImage {
  width: number;
  height: number;
}
type Doc = PDFKit.PDFDocument & { openImage(src: Buffer): PdfImage };

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export async function renderBook(book: BookContent, profile: PrintProfile): Promise<RenderedBook> {
  const bleed = mm(profile.bleedMm);
  const trimW = mm(profile.trimWidthMm);
  const trimH = mm(profile.trimHeightMm);
  const pageW = trimW + 2 * bleed;
  const pageH = trimH + 2 * bleed;
  const safe = mm(profile.safeMarginMm);
  // The trim box: what the reader sees after the cut.
  const T: Box = { x: bleed, y: bleed, w: trimW, h: trimH };
  // One "em", like the website's page font size: everything scales with the page.
  const em = trimW / 38;
  const warnings: string[] = [];

  const doc = new PDFDocument({
    size: [pageW, pageH],
    margin: 0,
    autoFirstPage: false,
    // No child's details in the file's hidden info: only the title.
    info: { Title: book.title, Author: "Dream Builder", Creator: "Dream Builder", Producer: "Dream Builder" },
  }) as Doc;
  for (const [name, bytes] of Object.entries(fonts())) doc.registerFont(name, bytes);
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const finished = new Promise<void>((resolve, reject) => {
    doc.on("end", () => resolve());
    doc.on("error", reject);
  });

  let pageCount = 0;
  const newPage = () => {
    doc.addPage({ size: [pageW, pageH], margin: 0 });
    pageCount += 1;
    // Tell the printer where the cut is (TrimBox) and how far the bleed goes (BleedBox).
    const page = doc.page.dictionary.data as Record<string, unknown>;
    page.TrimBox = [bleed, bleed, pageW - bleed, pageH - bleed];
    page.BleedBox = [0, 0, pageW, pageH];
  };

  // ---- Small drawing helpers ----------------------------------------------------------

  const font = (name: FontName, size: number, colour: string = COL.ink, opacity = 1) => {
    doc.font(name).fontSize(size).fillColor(colour, opacity);
  };

  /** One line (or a few) of centred text; shrinks to fit the width. Returns the height used. */
  const centred = (text: string, y: number, opts: { font: FontName; size: number; colour?: string; opacity?: number; width?: number; x?: number; spacing?: number; minSize?: number; lineGap?: number }) => {
    const width = opts.width ?? T.w - 2 * safe;
    const x = opts.x ?? T.x + (T.w - width) / 2;
    let size = opts.size;
    const o = { width, align: "center" as const, characterSpacing: (opts.spacing ?? 0) * size, lineGap: opts.lineGap ?? 0 };
    font(opts.font, size, opts.colour, opts.opacity);
    // Shrink a little if one long word would break.
    while (size > (opts.minSize ?? size * 0.6) && doc.widthOfString(text.split(/\s+/).reduce((a, b) => (b.length > a.length ? b : a), ""), o) > width) {
      size -= 0.5;
      doc.fontSize(size);
      o.characterSpacing = (opts.spacing ?? 0) * size;
    }
    const h = doc.heightOfString(text, o);
    doc.text(text, x, y, o);
    return h;
  };

  /** A four-point sparkle (the website's ✦), centred on (cx, cy). */
  const sparkle = (cx: number, cy: number, r: number, colour: string, opacity = 1) => {
    const k = r * 0.28;
    doc
      .moveTo(cx, cy - r)
      .bezierCurveTo(cx + k * 0.3, cy - k, cx + k, cy - k * 0.3, cx + r, cy)
      .bezierCurveTo(cx + k, cy + k * 0.3, cx + k * 0.3, cy + k, cx, cy + r)
      .bezierCurveTo(cx - k * 0.3, cy + k, cx - k, cy + k * 0.3, cx - r, cy)
      .bezierCurveTo(cx - k, cy - k * 0.3, cx - k * 0.3, cy - k, cx, cy - r)
      .closePath()
      .fillColor(colour, opacity)
      .fill();
  };

  /** The website's ornament: —— ✦ ——, centred on y. */
  const ornament = (y: number, scale = 1) => {
    const cx = T.x + T.w / 2;
    const line = 2.5 * em * scale;
    const gap = 0.6 * em * scale + 0.4 * em * scale;
    doc.save();
    doc.lineWidth(0.7).strokeColor(COL.amber400, 0.6);
    doc.moveTo(cx - gap - line, y).lineTo(cx - gap, y).stroke();
    doc.moveTo(cx + gap, y).lineTo(cx + gap + line, y).stroke();
    doc.restore();
    sparkle(cx, y, 0.42 * em * scale, COL.amber600, 0.85);
  };

  /** Cream book paper with the website's soft edge shading, over the whole page (incl. bleed). */
  const paper = () => {
    doc.rect(0, 0, pageW, pageH).fillColor(COL.paper, 1).fill();
    const shade = doc.radialGradient(pageW / 2, pageH * 0.45, 0, pageW / 2, pageH * 0.45, Math.max(pageW, pageH) * 0.75);
    shade.stop(0, "#8C6E32", 0).stop(0.62, "#8C6E32", 0).stop(1, "#8C6E32", 0.08);
    doc.fillOpacity(1).rect(0, 0, pageW, pageH).fill(shade);
  };

  /** The purple cover board, over the whole page (incl. bleed). */
  const board = () => {
    const g = doc.linearGradient(0, 0, pageW, pageH * 0.9);
    g.stop(0, "#7457EA").stop(0.45, "#5B3CD1").stop(1, "#4527AE");
    doc.fillOpacity(1).rect(0, 0, pageW, pageH).fill(g);
  };

  /**
   * The dotted lavender endpaper over the whole page. A PDF is flat pages, so no purple board
   * edge around it (that is only the website's 3D book).
   */
  const endpaper = () => {
    const area: Box = { x: 0, y: 0, w: pageW, h: pageH };
    doc.save();
    doc.rect(area.x, area.y, area.w, area.h).clip();
    doc.rect(area.x, area.y, area.w, area.h).fillColor(COL.endpaper, 1).fill();
    const step = T.w / 28;
    for (let y = area.y; y < area.y + area.h + step; y += step) {
      for (let x = area.x; x < area.x + area.w + step; x += step) {
        doc.circle(x, y, step * 0.06).fillColor(COL.brand, 0.22).fill();
        doc.circle(x + step / 2, y + step / 2, step * 0.05).fillColor(COL.amber600, 0.28).fill();
      }
    }
    doc.restore();
    return area;
  };

  /** Opens a picture; null if it can't be read (a warning is recorded). */
  const open = (bytes: Uint8Array | null, label: string): PdfImage | null => {
    if (!bytes || bytes.length === 0) return null;
    try {
      return doc.openImage(Buffer.from(bytes));
    } catch {
      warnings.push(`${label}: the picture could not be read (only PNG and JPEG are supported)`);
      return null;
    }
  };

  /** A picture that fills the box (cropped at the edges, like the website), with rounded corners. */
  const coverImage = (image: PdfImage, box: Box, label: string) => {
    doc.save();
    doc.roundedRect(box.x, box.y, box.w, box.h, em * 0.35).clip();
    doc.image(image as never, box.x, box.y, { cover: [box.w, box.h], align: "center", valign: "center" });
    doc.restore();
    // Pixels per inch as printed: the picture's pixel width over the width it covers on paper.
    const scale = Math.max(box.w / image.width, box.h / image.height);
    const dpi = Math.round(72 / scale);
    if (dpi < profile.minDpi) warnings.push(`${label}: ${image.width}×${image.height} px prints at ${dpi} dpi (the profile wants ${profile.minDpi})`);
  };

  /** A hero picture (transparent background) placed inside a box, keeping its shape. */
  const fitImage = (image: PdfImage, box: Box) => {
    const s = Math.min(box.w / image.width, box.h / image.height);
    const w = image.width * s;
    const h = image.height * s;
    doc.image(image as never, box.x + (box.w - w) / 2, box.y + (box.h - h) / 2, { width: w, height: h });
  };

  /** No real picture (or the stub AI's 1×1 placeholder): the hero on a soft storybook sky, like the website. */
  const heroScene = (box: Box) => {
    doc.save();
    doc.roundedRect(box.x, box.y, box.w, box.h, em * 0.35).clip();
    const sky = doc.linearGradient(0, box.y, 0, box.y + box.h);
    sky.stop(0, "#DDEBFA").stop(0.52, "#EEF0EC").stop(1, "#F2E6CC");
    doc.fillOpacity(1).rect(box.x, box.y, box.w, box.h).fill(sky);
    const sun = doc.radialGradient(box.x + box.w / 2, box.y + box.h * 0.33, 0, box.x + box.w / 2, box.y + box.h * 0.33, box.h * 0.28);
    sun.stop(0, "#FFF4CC", 0.95).stop(1, "#FFF4CC", 0);
    doc.fillOpacity(1).rect(box.x, box.y, box.w, box.h).fill(sun);
    doc.ellipse(box.x + box.w / 2, box.y + box.h * 1.02, box.w * 0.7, box.h * 0.26).fillColor("#E6D7B4", 0.7).fill();
    const hero = open(heroPicture(book.heroType, "standing"), "Hero art");
    if (hero) fitImage(hero, { x: box.x + box.w * 0.1, y: box.y + box.h * 0.05, w: box.w * 0.8, h: box.h * 0.88 });
    doc.restore();
  };

  // ---- The story pages' frame: running head and page number, like the website ----------
  const inner: Box = (() => {
    const side = Math.max(safe, T.w * 0.09);
    const top = Math.max(safe, T.h * 0.06);
    const bottom = Math.max(safe, T.h * 0.05);
    return { x: T.x + side, y: T.y + top, w: T.w - 2 * side, h: T.h - top - bottom };
  })();
  const headH = 1.5 * 0.72 * em;
  const footH = 1.4 * 0.8 * em;
  let storyPage = 0;

  /** A new story page: paper, the running head, the page number. Returns the content box. */
  const storyPageFrame = (part: string): Box => {
    newPage();
    paper();
    storyPage += 1;
    // The book's title on left (even) pages, the panel's name on right (odd) pages.
    const head = storyPage % 2 === 0 ? book.title : part;
    font("DisplayItalic", 0.72 * em, COL.inkFaint);
    doc.text(head, inner.x, inner.y, { width: inner.w, align: "center", lineBreak: false, ellipsis: true, height: headH });
    // —— 3 ——
    const fy = inner.y + inner.h - footH / 2;
    const num = String(storyPage);
    font("DisplayBold", 0.8 * em, COL.ink);
    const nw = doc.widthOfString(num);
    const cx = T.x + T.w / 2;
    doc.text(num, cx - nw / 2, fy - 0.8 * em * 0.62, { lineBreak: false });
    doc.save().lineWidth(0.7).strokeColor(COL.amber400, 0.6);
    doc.moveTo(cx - nw / 2 - 0.6 * em - 1.6 * em, fy).lineTo(cx - nw / 2 - 0.6 * em, fy).stroke();
    doc.moveTo(cx + nw / 2 + 0.6 * em, fy).lineTo(cx + nw / 2 + 0.6 * em + 1.6 * em, fy).stroke();
    doc.restore();
    const top = inner.y + headH + 0.8 * em;
    return { x: inner.x, y: top, w: inner.w, h: inner.y + inner.h - footH - 0.5 * em - top };
  };

  // Book text: Fraunces, justified, line height 1.7 (the website's).
  const bodySize = 1.02 * em;
  const body = { width: inner.w, align: "justify" as const, lineGap: bodySize * 0.7 };
  // One line of book text, including the gap below it (pdfkit's own line height leaves the gap out).
  const lineH = () => doc.currentLineHeight(true) + body.lineGap;

  /** How many of `words` fit in a box of this width and height (binary search, like the website). */
  const wordsThatFit = (words: string[], width: number, height: number): number => {
    let lo = 0;
    let hi = words.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (doc.heightOfString(words.slice(0, mid).join(" "), { ...body, width }) <= height + 0.5) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  /** Writes words into a box; returns the words left over and the height used. */
  const flow = (words: string[], box: Box, dropCap: boolean): { rest: string[]; used: number } => {
    font("Display", bodySize, COL.ink);
    const lh = lineH();
    let y = box.y;
    let rest = words;
    // The drop capital: the first letter large and amber, the first two lines beside it.
    if (dropCap && rest.length > 0 && /^[A-Za-z]/.test(rest[0]) && box.h >= 2 * lh) {
      // "Once" → a big "O", and "nce in the…" beside it.
      const letter = rest[0][0];
      rest = [rest[0].slice(1), ...rest.slice(1)].filter((w, i) => i > 0 || w.length > 0);
      font("DisplayBold", 3.2 * bodySize, COL.amber800);
      const capW = doc.widthOfString(letter) + 0.12 * em;
      doc.text(letter, box.x, y - 0.3 * bodySize, { lineBreak: false, lineGap: 0 });
      font("Display", bodySize, COL.ink);
      const besideW = box.w - capW;
      const n = wordsThatFit(rest, besideW, 2 * lh);
      if (n > 0) doc.text(rest.slice(0, n).join(" "), box.x + capW, y, { ...body, width: besideW });
      rest = rest.slice(n);
      y += 2 * lh;
    }
    const n = wordsThatFit(rest, box.w, box.y + box.h - y);
    if (n > 0) {
      const chunk = rest.slice(0, n).join(" ");
      doc.text(chunk, box.x, y, { ...body, width: box.w });
      y += doc.heightOfString(chunk, { ...body, width: box.w });
    }
    return { rest: rest.slice(n), used: y - box.y };
  };

  // ======================================================================================
  // 1. The cover
  newPage();
  board();
  {
    // A flat cover (no spine shading: that is only the website's 3D book). Gold foil frame (two lines).
    const f1: Box = { x: T.x + T.w * 0.0775, y: T.y + T.h * 0.055, w: T.w * 0.845, h: T.h * 0.89 };
    doc.roundedRect(f1.x, f1.y, f1.w, f1.h, em * 0.4).lineWidth(0.8).strokeColor(COL.amber200, 0.45).stroke();
    doc.roundedRect(f1.x + T.w * 0.015, f1.y + T.h * 0.015, f1.w - T.w * 0.03, f1.h - T.h * 0.03, em * 0.3).lineWidth(0.8).strokeColor(COL.amber200, 0.2).stroke();
    // The ribbon bookmark, from the top edge.
    const rw = T.w * 0.07;
    const rx = T.x + T.w * 0.91 - rw;
    const rh = T.y + T.h * 0.11;
    doc.polygon([rx, 0], [rx + rw, 0], [rx + rw, rh], [rx + rw / 2, rh - (rh - T.y) * 0.18], [rx, rh]).fillColor(COL.amber400, 1).fill();
    const bx = rx + rw * 0.3;
    const bw = rw * 0.4;
    const by = rh - (rh - T.y) * 0.62;
    const bh = (rh - T.y) * 0.4;
    doc.polygon([bx, by], [bx + bw, by], [bx + bw, by + bh], [bx + bw / 2, by + bh * 0.72], [bx, by + bh]).fillColor("#FFFFFF", 1).fill();

    // The words, centred in the frame.
    const cw = T.w * 0.68;
    const cx = T.x + (T.w - cw) / 2;
    let y = T.y + T.h * 0.13;
    // "EXPLORER EDITION" pill
    const pill = `${book.edition} Edition`.toUpperCase();
    const ps = 0.62 * em * 1.15;
    font("SansHeavy", ps, "#FFFFFF");
    const pw = doc.widthOfString(pill, { characterSpacing: ps * 0.16 }) + 1.8 * ps;
    const ph = ps * 2;
    doc.roundedRect(cx + cw / 2 - pw / 2, y, pw, ph, ph / 2).fillColor(COL.pill, 0.6).fill();
    font("SansHeavy", ps, "#FFFFFF");
    doc.text(pill, cx + cw / 2 - pw / 2, y + ps * 0.48, { width: pw, align: "center", characterSpacing: ps * 0.16, lineBreak: false });
    y += ph + 0.9 * em;
    y += centred(book.title, y, { font: "DisplayBold", size: 2.6 * em, colour: "#FFFFFF", width: cw, x: cx, minSize: 1.4 * em, lineGap: -0.2 * em });
    y += 0.6 * em;
    if (book.authorName.trim()) y += centred(`by ${book.authorName.trim()}`, y, { font: "SansBold", size: 1.05 * em, colour: "#FFFFFF", opacity: 0.92, width: cw, x: cx });
    y += 0.3 * em;
    y += centred(`Written ${formatWrittenDate(book.writtenOn)}`, y, { font: "Sans", size: 0.7 * em, colour: "#FFFFFF", opacity: 0.75, width: cw, x: cx });
    // The hero, with a warm glow behind.
    const area: Box = { x: cx, y: y + 0.8 * em, w: cw, h: T.y + T.h * 0.9 - (y + 0.8 * em) };
    const gx = area.x + area.w / 2;
    const gy = area.y + area.h / 2;
    const glow = doc.radialGradient(gx, gy, 0, gx, gy, Math.min(area.w, area.h) * 0.5);
    glow.stop(0, "#FFECAA", 0.45).stop(0.68, "#FFECAA", 0);
    doc.fillOpacity(1).rect(area.x, area.y, area.w, area.h).fill(glow);
    const avatar = open(heroPicture(book.heroType, "avatar"), "Hero art");
    if (avatar) fitImage(avatar, { x: area.x + area.w * 0.1, y: area.y, w: area.w * 0.8, h: area.h });
    // A soft sheen across the laminated cover.
    const sheen = doc.linearGradient(0, 0, pageW, pageH * 0.45);
    sheen.stop(0.3, "#FFFFFF", 0).stop(0.45, "#FFFFFF", 0.1).stop(0.6, "#FFFFFF", 0);
    doc.fillOpacity(1).rect(0, 0, pageW, pageH).fill(sheen);
  }

  // 2. Inside cover: "This book belongs to"
  newPage();
  {
    const area = endpaper();
    const cw = Math.min(area.w * 0.7, 16 * em * 1.2);
    const ch = 9 * em;
    const cx = area.x + (area.w - cw) / 2;
    const cy = area.y + (area.h - ch) / 2;
    doc.roundedRect(cx, cy, cw, ch, em * 0.7).fillColor("#FFFFFF", 0.92).fill();
    doc.roundedRect(cx, cy, cw, ch, em * 0.7).lineWidth(1.5).strokeColor(COL.brand, 0.2).stroke();
    let y = cy + 1.6 * em;
    y += centred("THIS BOOK BELONGS TO", y, { font: "SansHeavy", size: 0.66 * em, colour: COL.brand, width: cw - 2 * em, x: cx + em, spacing: 0.24 });
    y += 0.6 * em;
    y += centred(book.authorName.trim() || book.heroName, y, { font: "DisplayBoldItalic", size: 1.6 * em, colour: COL.ink, width: cw - 2 * em, x: cx + em, minSize: 0.9 * em });
    doc.moveTo(cx + cw * 0.1, y + 0.3 * em).lineTo(cx + cw * 0.9, y + 0.3 * em).lineWidth(0.7).strokeColor(COL.brand, 0.25).stroke();
    y += 1.1 * em;
    centred("Author & illustrator of their own adventure", y, { font: "Sans", size: 0.7 * em, colour: COL.inkMuted, width: cw - 2 * em, x: cx + em });
  }

  // 3. The title page
  newPage();
  paper();
  {
    const w = T.w * 0.8;
    const x = T.x + T.w * 0.1;
    let y = T.y + T.h * 0.11;
    y += centred("A DREAM BUILDER STORY", y, { font: "SansHeavy", size: 0.66 * em, colour: COL.brand, width: w, x, spacing: 0.28 });
    y += 0.7 * em;
    y += centred(book.title, y, { font: "DisplayBold", size: 2.05 * em, colour: COL.ink, width: w, x, minSize: 1.2 * em, lineGap: -0.15 * em });
    y += 1 * em;
    ornament(y);
    y += 1.4 * em;
    // The hero in a circle with a gold ring.
    const d = T.w * 0.42;
    const ccx = T.x + T.w / 2;
    const ccy = y + d / 2;
    doc.circle(ccx, ccy, d / 2 + 0.3 * em).fillColor(COL.amber200, 0.7).fill();
    const bg = doc.radialGradient(ccx, ccy - d * 0.1, 0, ccx, ccy, d / 2);
    bg.stop(0, "#FFF6DA").stop(0.7, "#EEEAFB").stop(1, "#EEEAFB");
    doc.fillOpacity(1).circle(ccx, ccy, d / 2).fill(bg);
    const avatar = open(heroPicture(book.heroType, "avatar"), "Hero art");
    if (avatar) {
      doc.save();
      doc.circle(ccx, ccy, d / 2).clip();
      fitImage(avatar, { x: ccx - d * 0.44, y: ccy - d * 0.44, w: d * 0.88, h: d * 0.88 });
      doc.restore();
    }
    let by = T.y + T.h * 0.92 - 4.2 * em;
    by += centred("WRITTEN BY", by, { font: "SansBold", size: 0.72 * em, colour: COL.inkMuted, width: w, x, spacing: 0.2 });
    by += 0.2 * em;
    by += centred(book.authorName.trim() || book.heroName, by, { font: "DisplayBold", size: 1.3 * em, colour: COL.ink, width: w, x });
    by += 0.9 * em;
    centred(`${book.edition} Edition`, by, { font: "SansBold", size: 0.68 * em, colour: COL.inkFaint, width: w, x });
  }

  // 4. Today's Mission (guide BE-18)
  {
    const box = storyPageFrame("Today's Mission");
    let y = box.y + box.h * 0.12;
    y += centred("TODAY'S MISSION", y, { font: "SansHeavy", size: 0.8 * em, colour: COL.amber700, width: box.w, x: box.x, spacing: 0.24 });
    y += 0.45 * em;
    ornament(y + 0.4 * em);
    y += 2 * em;
    const lines: string[] = [];
    if (book.aspiration.trim()) lines.push(`${book.heroName} dreams of this: ${book.aspiration.trim()}`);
    if (book.oneMoreAmazingThing.trim()) lines.push(`One more amazing thing about ${book.heroName}: ${book.oneMoreAmazingThing.trim()}`);
    if (lines.length === 0) lines.push(`Join ${book.heroName} on a brave adventure.`);
    for (const line of lines) {
      y += centred(line, y, { font: "Display", size: 1.15 * em, colour: COL.ink, width: box.w, x: box.x, lineGap: 0.5 * em });
      y += 1 * em;
    }
    centred("Turn the page to begin the adventure!", y + 0.5 * em, { font: "DisplayItalic", size: 0.95 * em, colour: COL.inkMuted, width: box.w, x: box.x });
  }

  // 5. The story: each panel opens a page with its picture; long text carries on overleaf.
  // A comic (BE-11) draws its comic pages instead.
  if (book.comic) for (const page of book.comic) comicPage(page);
  else for (const panel of book.panels) {
    const label = `Panel ${panel.number}`;
    const box = storyPageFrame(panel.label);
    // The picture: 16:10, the website's shape on a wide screen.
    const imgBox: Box = { x: box.x, y: box.y, w: box.w, h: Math.min(box.w / 1.6, box.h * 0.55) };
    const image = open(panel.image, label);
    if (image && image.width >= PLACEHOLDER_MAX_WIDTH) {
      coverImage(image, imgBox, label);
    } else {
      warnings.push(`${label}: ${image ? "only a placeholder picture" : "no picture"} (the hero is shown instead)`);
      heroScene(imgBox);
    }
    let y = imgBox.y + imgBox.h + 0.9 * em;
    y += centred(panel.label.toUpperCase(), y, { font: "SansHeavy", size: 0.66 * em, colour: COL.amber700, width: box.w, x: box.x, spacing: 0.24 });
    y += 0.45 * em;
    ornament(y + 0.2 * em);
    y += 0.9 * em + 0.4 * em;

    let words = panel.text.trim().split(/\s+/).filter(Boolean);
    let current: Box = { x: box.x, y, w: box.w, h: box.y + box.h - y };
    let first = true;
    for (let guard = 0; words.length > 0 && guard < 50; guard += 1) {
      // No big first letter at the start of a page (Sami Bhai asked, 2026-11-25).
      const out = flow(words, current, false);
      if (out.rest.length === words.length && !first) {
        // Not even one word fits an empty page (can't happen with real text): stop, don't loop.
        warnings.push(`${label}: some text did not fit`);
        break;
      }
      first = false;
      words = out.rest;
      if (words.length > 0) current = storyPageFrame(panel.label);
    }
  }

  /**
   * One comic page (BE-11), styled like a printed children's comic: 4 panels in the page's
   * arrangement (a big panel for the big moment, see comicPlan.ts LAYOUTS), heavy ink frames,
   * the balloon in a white band at the top of its panel (its tail reaching into the picture),
   * the sound effect on the picture, and the short picture-book line under it. The words never
   * hide the art.
   */
  function comicPage(page: ComicPage): void {
    const box = storyPageFrame(page.label || book.title);
    const gap = 0.7 * em;
    COMIC_FRAMES[page.layout ?? "grid"].forEach(([fx, fy, fw, fh], i) => {
      const cell = page.cells[i];
      if (!cell) return;
      const label = `Comic page ${page.page}, cell ${i + 1}`;
      // Fractions of the page, less half a gutter on each inner edge.
      const x0 = box.x + fx * box.w + (fx > 0 ? gap / 2 : 0);
      const y0 = box.y + fy * box.h + (fy > 0 ? gap / 2 : 0);
      const x1 = box.x + (fx + fw) * box.w - (fx + fw < 1 ? gap / 2 : 0);
      const y1 = box.y + (fy + fh) * box.h - (fy + fh < 1 ? gap / 2 : 0);
      const frame: Box = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      // A soft offset shadow, then the white panel.
      doc.rect(frame.x + 2.2, frame.y + 2.2, frame.w, frame.h).fillColor(COL.ink, 0.16).fill();
      doc.rect(frame.x, frame.y, frame.w, frame.h).fillColor("#FFFFFF", 1).fill();

      const balloon = balloonBand(cell, frame);
      const line = narrationLine(cell.caption, frame);
      const pic: Box = { x: frame.x, y: frame.y + balloon.height, w: frame.w, h: frame.h - balloon.height - line.height };
      const image = open(cell.image, label);
      if (image && image.width >= PLACEHOLDER_MAX_WIDTH) coverImage(image, pic, label);
      else {
        warnings.push(`${label}: ${image ? "only a placeholder picture" : "no picture"} (the hero is shown instead)`);
        heroScene(pic);
      }
      if (balloon.height > 0) doc.moveTo(pic.x, pic.y).lineTo(pic.x + pic.w, pic.y).lineWidth(1.6).strokeColor(COL.ink, 1).stroke();
      if (line.height > 0) doc.moveTo(pic.x, pic.y + pic.h).lineTo(pic.x + pic.w, pic.y + pic.h).lineWidth(1.6).strokeColor(COL.ink, 1).stroke();
      if (cell.sfx) soundEffect(cell.sfx, pic);
      if (cell.tempo) tempoBubble(cell.tempo, pic);
      balloon.draw(pic.y);
      line.draw(pic.y + pic.h);
      doc.rect(frame.x, frame.y, frame.w, frame.h).lineWidth(1.8).strokeColor(COL.ink, 1).stroke();
    });
  }

  /** The picture-book line under a panel: plain italic book text, no box. Often there is none. */
  function narrationLine(text: string, frame: Box): { height: number; draw: (top: number) => void } {
    const t = text.trim();
    if (!t) return { height: 0, draw: () => undefined };
    const pad = 0.4 * em;
    const w = frame.w - pad * 2;
    const size = fitSize(t, "DisplayItalic", 0.62 * em, w, frame.h * 0.3, { lineGap: 0.5, align: "center" });
    const h = Math.min(frame.h * 0.3, doc.heightOfString(t, { width: w, lineGap: 0.5, align: "center" })) + pad * 1.6;
    return {
      height: h,
      draw: (top) => {
        doc.rect(frame.x, top, frame.w, h).fillColor("#FFFDF6", 1).fill();
        font("DisplayItalic", size, COL.ink);
        doc.text(t, frame.x + pad, top + pad * 0.8, { width: w, lineGap: 0.5, align: "center" });
      },
    };
  }

  /**
   * The balloon band at the top of a panel: measures it (so the picture gets the rest) and
   * returns a function that draws it once the picture is in place (the tail overlaps it).
   * Speech is an oval with a tail, thought a straight-edged balloon with cut corners and little circles, whisper a dashed oval,
   * shout a spiky burst.
   */
  function balloonBand(cell: ComicCellContent, frame: Box): { height: number; draw: (picTop: number) => void } {
    const text = cell.dialogue?.trim();
    if (!text || cell.bubbleType === "none") return { height: 0, draw: () => undefined };
    const kind = cell.bubbleType;
    const pad = 0.45 * em;
    const shout = kind === "shout";
    const thought = kind === "thought";
    const padX = shout ? 1.4 * em : thought ? 0.8 * em : 0.75 * em;
    const padY = shout ? 0.8 * em : thought ? 0.45 * em : 0.42 * em;
    const maxW = frame.w * 0.86;
    const family: FontName = shout ? "SansHeavy" : "SansBold";
    const size = fitSize(text, family, (shout ? 0.66 : 0.62) * em, maxW - padX * 2, frame.h * 0.3, { align: "center" });
    const textW = Math.min(maxW - padX * 2, doc.widthOfString(text) + 1);
    const w = textW + padX * 2;
    const h = doc.heightOfString(text, { width: textW, align: "center" }) + padY * 2;
    return {
      height: h + pad * 2,
      draw: (picTop) => {
        // Left of centre, so the tail can point down at the hero (the pictures keep the hero central).
        const bx = frame.x + Math.max(pad, (frame.w - w) * 0.35);
        const by = picTop - pad - h;
        const tx = Math.min(Math.max(bx + w * 0.55, frame.x + frame.w * 0.4), frame.x + frame.w * 0.6);
        const r = Math.min(h / 2, 1.2 * em);
        doc.save();
        if (kind === "speech" || kind === "whisper") {
          const tail: [number, number][] = [
            [tx - 0.4 * em, by + h - 1],
            [tx + 0.4 * em, by + h - 1],
            [tx - 0.05 * em, picTop + 1.0 * em],
          ];
          const pen = () => (kind === "whisper" ? doc.lineWidth(1.1).dash(2.2, { space: 1.8 }) : doc.lineWidth(1.2));
          doc.polygon(...tail).fillColor("#FFFFFF", 1).fill();
          pen();
          doc.moveTo(...tail[0]).lineTo(...tail[2]).lineTo(...tail[1]).strokeColor(COL.ink, 1).stroke();
          doc.roundedRect(bx, by, w, h, r).fillColor("#FFFFFF", 1).fill();
          pen();
          doc.roundedRect(bx, by, w, h, r).strokeColor(COL.ink, 1).stroke();
          doc.undash();
          // Join the tail to the balloon (hide the outline where they meet).
          doc.rect(tx - 0.38 * em, by + h - 1.5, 0.76 * em, 2.4).fillColor("#FFFFFF", 1).fill();
        } else if (thought) {
          // Straight edges with the corners cut off, then little circles down to the thinker.
          const c = Math.min(0.75 * em, h / 3);
          doc
            .polygon([bx + c, by], [bx + w - c, by], [bx + w, by + c], [bx + w, by + h - c], [bx + w - c, by + h], [bx + c, by + h], [bx, by + h - c], [bx, by + c])
            .lineWidth(1.2)
            .lineJoin("miter")
            .fillAndStroke("#FFFFFF", COL.ink);
          for (const [dy, rad, dx] of [
            [0.55, 0.26, 0],
            [1.1, 0.16, -0.25],
          ] as const) {
            doc.circle(tx + dx * em, by + h + dy * em, rad * em).lineWidth(1).fillAndStroke("#FFFFFF", COL.ink);
          }
        } else {
          // Shout: a spiky burst, with a sharp tail.
          const spikes = Math.max(14, Math.round((w + h) / (0.75 * em)));
          const pts: [number, number][] = [];
          for (let k = 0; k < spikes * 2; k += 1) {
            const a = (k / (spikes * 2)) * Math.PI * 2;
            const out = k % 2 === 0 ? 1 : 0.82;
            pts.push([bx + w / 2 + Math.cos(a) * (w / 2) * out, by + h / 2 + Math.sin(a) * (h / 2) * out]);
          }
          doc.polygon([tx - 0.35 * em, by + h * 0.85], [tx + 0.35 * em, by + h * 0.85], [tx, picTop + 1.0 * em]).lineWidth(1.3).fillAndStroke("#FFFFFF", COL.ink);
          doc.polygon(...pts).lineWidth(1.3).fillAndStroke("#FFFFFF", COL.ink);
        }
        doc.restore();
        font(family, size, COL.ink);
        doc.text(text, bx + padX, by + padY, { width: textW, align: "center" });
      },
    };
  }

  /** A sound effect, big and bold on the picture, like a printed comic ("WHOOSH!"). */
  function soundEffect(sfx: string, pic: Box): void {
    const size = Math.min(1.5 * em, pic.h * 0.2);
    font("SansHeavy", size, COL.amber400);
    const w = doc.widthOfString(sfx);
    const x = pic.x + Math.max(0.5 * em, Math.min(pic.w * 0.08, pic.w - w - 0.5 * em));
    const y = pic.y + pic.h - size * 1.5;
    doc.save();
    doc.rotate(-8, { origin: [x + w / 2, y + size / 2] });
    // A thick ink outline first, then the bright letters on top (so the outline sits outside them).
    doc.lineWidth(size * 0.16).lineJoin("round").strokeColor(COL.ink, 1);
    doc.text(sfx, x, y, { lineBreak: false, stroke: true, fill: false });
    font("SansHeavy", size, "#FFC93C");
    doc.text(sfx, x, y, { lineBreak: false });
    doc.restore();
  }

  /** Shrinks the font until the text fits the height (never below the smallest readable size). */
  function fitSize(text: string, family: FontName, start: number, width: number, maxH: number, opts: PDFKit.Mixins.TextOptions): number {
    let size = start;
    font(family, size, COL.ink);
    while (size > 0.48 * em && doc.heightOfString(text, { width, ...opts }) > maxH) {
      size -= 0.02 * em;
      doc.fontSize(size);
    }
    return size;
  }

  /** Tempo's bubble, bottom-right of the picture: drawn music notes (one per symbol, at most 4). */
  function tempoBubble(tempo: string, pic: Box): void {
    const count = Math.max(1, Math.min(4, tempo.split(/\s+/).filter(Boolean).length));
    const s = 0.75 * em;
    const w = count * s * 0.9 + 0.8 * em;
    const h = s * 1.6;
    const bx = pic.x + pic.w - w - 0.5 * em;
    const by = pic.y + pic.h - h - 0.5 * em;
    doc.roundedRect(bx, by, w, h, h / 2).fillColor("#FEF3C7", 1).fill();
    doc.roundedRect(bx, by, w, h, h / 2).lineWidth(0.9).strokeColor(COL.amber600, 1).stroke();
    for (let i = 0; i < count; i += 1) note(bx + 0.4 * em + i * s * 0.9 + s * 0.25, by + h * 0.68 - (i % 2) * s * 0.18, s);
  }

  /** One music note: a head, a stem and a flag. */
  function note(x: number, y: number, s: number): void {
    doc.save();
    doc.fillColor(COL.amber800, 1).strokeColor(COL.amber800, 1);
    doc.ellipse(x, y, s * 0.2, s * 0.14).fill();
    doc.rect(x + s * 0.16, y - s * 0.75, s * 0.06, s * 0.75).fill();
    doc.moveTo(x + s * 0.22, y - s * 0.75).bezierCurveTo(x + s * 0.42, y - s * 0.62, x + s * 0.46, y - s * 0.45, x + s * 0.36, y - s * 0.32).lineWidth(s * 0.07).stroke();
    doc.restore();
  }

  // Filler pages, only when the printer needs a page-count multiple (The End and the back
  // cover still to come).
  while ((pageCount + 2) % profile.pageCountMultiple !== 0) {
    const box = storyPageFrame("My drawing");
    let y = box.y;
    y += centred("MY DRAWING", y, { font: "SansHeavy", size: 0.8 * em, colour: COL.amber700, width: box.w, x: box.x, spacing: 0.24 });
    y += 0.3 * em;
    y += centred(`Draw ${book.heroName}'s next adventure here!`, y, { font: "DisplayItalic", size: 0.9 * em, colour: COL.inkMuted, width: box.w, x: box.x });
    y += 0.8 * em;
    doc.roundedRect(box.x, y, box.w, box.y + box.h - y, em * 0.5).lineWidth(1.2).dash(6, { space: 4 }).strokeColor(COL.amber400, 0.8).stroke().undash();
  }

  // The End
  newPage();
  paper();
  {
    const w = T.w * 0.8;
    const x = T.x + T.w * 0.1;
    let y = T.y + T.h * 0.17;
    ornament(y);
    y += 1.1 * em;
    y += centred("The End", y, { font: "DisplayBoldItalic", size: 2.6 * em, colour: COL.ink, width: w, x });
    y += 1.2 * em;
    const d = T.w * 0.52;
    const cx = T.x + T.w / 2;
    const glow = doc.radialGradient(cx, y + d / 2, 0, cx, y + d / 2, d * 0.42);
    glow.stop(0, "#FFF4CF").stop(0.7, "#FFF4CF", 0);
    doc.fillOpacity(1).rect(cx - d / 2, y, d, d).fill(glow);
    const rest = open(heroPicture(book.heroType, "breathe"), "Hero art");
    if (rest) fitImage(rest, { x: cx - d / 2, y, w: d, h: d });
    y += d + 1 * em;
    y += centred(`Thank you for reading ${book.title}.`, y, { font: "DisplayItalic", size: 0.92 * em, colour: COL.inkMuted, width: T.w * 0.6, x: T.x + T.w * 0.2, lineGap: 0.3 * em });
    y += 0.8 * em;
    if (book.authorName.trim()) centred(`A story by ${book.authorName.trim()}`, y, { font: "SansBold", size: 0.72 * em, colour: COL.inkMuted, width: w, x });
  }

  // The back cover
  newPage();
  board();
  {
    const w = T.w * 0.7;
    const x = T.x + T.w * 0.15;
    let y = T.y + T.h * 0.3;
    sparkle(T.x + T.w / 2, y, 1.1 * em, COL.amber200, 0.9);
    y += 1.8 * em;
    y += centred(book.title, y, { font: "DisplayBold", size: 1.5 * em, colour: "#FFFFFF", width: w, x, minSize: 0.9 * em });
    y += 0.6 * em;
    if (book.authorName.trim()) centred(`${book.authorName.trim()} · ${book.writtenOn.getFullYear()}`, y, { font: "SansBold", size: 0.8 * em, colour: "#FFFFFF", opacity: 0.85, width: w, x });
    // The lower middle of this page is kept free for the voice QR code (BE-15, later).
    centred("Made with Dream Builder", T.y + T.h - Math.max(safe, T.h * 0.06) - 1.2 * em, { font: "DisplayBold", size: 0.9 * em, colour: "#FFFFFF", opacity: 0.9, width: w, x });
  }

  doc.end();
  await finished;
  return { pdf: Buffer.concat(chunks), pageCount, warnings };
}

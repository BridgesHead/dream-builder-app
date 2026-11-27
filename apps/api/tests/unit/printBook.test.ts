// BE-18: drawing the book PDF (src/print/renderBook.ts) with the print profiles. No database:
// the book's words and pictures are made up here.
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { getPrintProfile, PRINT_PROFILES, type PrintProfile } from "../../src/print/profiles.js";
import { formatWrittenDate, renderBook, type BookContent } from "../../src/print/renderBook.js";
import { FAKE_PNG } from "../helpers/fakeFal.js";

/** A plain-colour PNG of any size (a stand-in for an AI picture). */
function solidPng(width: number, height: number): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(width * 3, 0x88)]);
  const pixels = deflateSync(Buffer.concat(Array.from({ length: height }, () => row)));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", pixels), chunk("IEND", Buffer.alloc(0))]);
}
const PICTURE = solidPng(320, 240);

const book = (panelCount: number, overrides: Partial<BookContent> = {}): BookContent => ({
  title: "Ember and the Healing Paws",
  heroName: "Ember",
  heroType: "fox",
  edition: "Explorer",
  authorName: "Test Child",
  writtenOn: new Date("2026-03-14T08:00:00Z"),
  aspiration: "to be a vet",
  oneMoreAmazingThing: "she whistles like a kettle",
  panels: Array.from({ length: panelCount }, (_, i) => ({ number: i + 1, label: `Part ${i + 1}`, text: `Once upon a time, page ${i + 1} of the story.`, image: PICTURE })),
  ...overrides,
});

// The pages around the story: cover, "This book belongs to", title page, Today's Mission
// before; The End and the back cover after.
const AROUND = 6;

const MM = 72 / 25.4;
/** Every page's size in points, read from the PDF's page records. */
function pageSizes(pdf: Buffer): number[][] {
  return [...pdf.toString("latin1").matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => [Number(m[1]), Number(m[2])]);
}

describe("BE-18 book PDF pages", () => {
  it("a two-act book: the pages around the story and the 12 panels, one page each (no Act 3, no blank pages)", async () => {
    const out = await renderBook(book(12), getPrintProfile("generic"));
    expect(out.pageCount).toBe(AROUND + 12);
    expect(pageSizes(out.pdf)).toHaveLength(AROUND + 12);
    expect(out.pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });

  it("a three-act book has all 15 panels", async () => {
    const out = await renderBook(book(15), getPrintProfile("generic"));
    expect(out.pageCount).toBe(AROUND + 15);
  });

  it("portrait pages, like the website's book; switching the profile changes page size and bleed with no code change", async () => {
    const print = await renderBook(book(12), getPrintProfile("generic"));
    const screen = await renderBook(book(12), getPrintProfile("digital"));
    // generic: 203.2 × 254 mm + 3 mm bleed on each side. digital: no bleed.
    const [pw, ph] = pageSizes(print.pdf)[0];
    expect(pw).toBeCloseTo(209.2 * MM, 1);
    expect(ph).toBeCloseTo(260 * MM, 1);
    expect(ph).toBeGreaterThan(pw);
    expect(pageSizes(screen.pdf)[0][0]).toBeCloseTo(203.2 * MM, 1);
    // The printer's file says where the cut is (TrimBox) inside the bleed.
    expect(print.pdf.toString("latin1")).toMatch(/\/TrimBox \[8\.50/);

    // A publisher's profile is only numbers.
    const square: PrintProfile = { ...PRINT_PROFILES.generic, id: "test", trimWidthMm: 210, trimHeightMm: 210, bleedMm: 5 };
    const [w, h] = pageSizes((await renderBook(book(12), square)).pdf)[0];
    expect(w).toBeCloseTo(220 * MM, 1);
    expect(h).toBeCloseTo(220 * MM, 1);
  });

  it("a profile that needs a page-count multiple gets drawing pages, never blank ones", async () => {
    const out = await renderBook(book(12), { ...PRINT_PROFILES.generic, pageCountMultiple: 4 });
    expect(out.pageCount).toBe(20); // 18 + 2 "My drawing" pages
  });

  it("warns (doesn't fail) when a picture is below the profile's dpi", async () => {
    const out = await renderBook(book(12), getPrintProfile("generic"));
    expect(out.warnings.some((w) => /^Panel 1: 320×240 px prints at \d+ dpi \(the profile wants 300\)$/.test(w))).toBe(true);
  });

  it("a missing picture, or the stub AI's 1×1 placeholder, shows the hero instead (and a warning)", async () => {
    const panels = book(12).panels.map((p) => (p.number === 2 ? { ...p, image: null } : p.number === 4 ? { ...p, image: FAKE_PNG } : p));
    const out = await renderBook(book(12, { panels }), getPrintProfile("generic"));
    expect(out.warnings).toContain("Panel 2: no picture (the hero is shown instead)");
    expect(out.warnings).toContain("Panel 4: only a placeholder picture (the hero is shown instead)");
    expect(out.pageCount).toBe(AROUND + 12);
  });

  it("a picture that isn't PNG or JPEG gives a warning, not a broken book", async () => {
    const panels = book(12).panels.map((p) => (p.number === 3 ? { ...p, image: new Uint8Array([1, 2, 3, 4]) } : p));
    const out = await renderBook(book(12, { panels }), getPrintProfile("digital"));
    expect(out.warnings).toContain("Panel 3: the picture could not be read (only PNG and JPEG are supported)");
  });

  it("a long text carries on to the next page, like the website's book; nothing is cut", async () => {
    const long = "The hero took one more brave step. ".repeat(80);
    const out = await renderBook(book(12, { panels: book(12).panels.map((p) => ({ ...p, text: long })) }), getPrintProfile("generic"));
    expect(out.pageCount).toBeGreaterThan(AROUND + 12 * 2);
    expect(out.warnings.some((w) => w.includes("did not fit"))).toBe(false);
  });

  it("a comic (BE-11): one page per comic page (8 for two acts, 10 for three) instead of the panel pages", async () => {
    const cells = (page: number) =>
      [0, 1, 2, 3].map((i) => ({
        caption: `Cell ${i + 1} of page ${page}.`,
        dialogue: i === 1 ? "I can do this." : i === 2 ? "Maybe…" : null,
        bubbleType: (i === 1 ? "speech" : i === 2 ? "thought" : "none") as "speech" | "thought" | "none",
        tempo: i === 3 ? "♪ ♫" : null,
        image: PICTURE,
      }));
    const comic = (pages: number) => Array.from({ length: pages }, (_, p) => ({ page: p + 1, label: `Page ${p + 1}`, cells: cells(p + 1) }));
    expect((await renderBook(book(12, { comic: comic(8) }), getPrintProfile("digital"))).pageCount).toBe(AROUND + 8);
    const three = await renderBook(book(15, { comic: comic(10) }), getPrintProfile("generic"));
    expect(three.pageCount).toBe(AROUND + 10);
    expect(three.warnings.some((w) => w.includes("did not fit"))).toBe(false);
  });

  it("a comic page in every arrangement, with every balloon, a sound effect and no narration: one page each, no warnings", async () => {
    const kinds = ["speech", "thought", "whisper", "shout"] as const;
    const comic = (["big_top", "big_bottom", "tall", "grid"] as const).map((layout, p) => ({
      page: p + 1,
      label: "",
      layout,
      cells: kinds.map((bubbleType, i) => ({ caption: i === 0 ? "The next morning…" : "", dialogue: "I can do this!", bubbleType, tempo: null, sfx: i === 1 ? "WHOOSH!" : null, image: PICTURE })),
    }));
    const out = await renderBook(book(12, { comic }), getPrintProfile("digital"));
    expect(out.pageCount).toBe(AROUND + 4);
    expect(out.warnings.filter((w) => !w.includes("dpi"))).toEqual([]);
  });

  it("the cover date is written as a day, month and year (UAE time)", () => {
    expect(formatWrittenDate(new Date("2026-03-14T08:00:00Z"))).toBe("14 March 2026");
    // 22:00 UTC is already the next day in the UAE.
    expect(formatWrittenDate(new Date("2026-03-14T22:00:00Z"))).toBe("15 March 2026");
  });

  it("puts no child details in the file's hidden info", async () => {
    const out = await renderBook(book(12), getPrintProfile("digital"));
    expect(out.pdf.toString("latin1")).not.toContain("Test Child");
  });
});

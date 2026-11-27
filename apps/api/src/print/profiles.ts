// Print profiles (guide BE-18): the page rules for each printer, as plain settings.
//
// A new publisher = one more entry here + PRINT_PROFILE=<its id> in the settings. The code
// that draws the book (renderBook.ts) only reads these numbers, so switching profile changes
// page size, bleed and margins with no code change.
//
//   trim         the finished page size, after the printer cuts it
//   bleed        extra picture/colour past the trim on every side, so the cut never shows a
//                white edge (0 for a PDF read on screen)
//   safe margin  how far in from the trim text and pictures must stay, so nothing is cut off
//
// No imports here: config.ts reads PRINT_PROFILE_IDS, so this file must load on its own.

export interface PrintProfile {
  id: string;
  /** What admin and logs show. */
  name: string;
  trimWidthMm: number;
  trimHeightMm: number;
  bleedMm: number;
  safeMarginMm: number;
  /** Pictures below this (pixels per inch, as placed on the page) get a warning on the order. */
  minDpi: number;
  /** "RGB" for now; a publisher that needs CMYK converts at their end, or a later profile does. */
  colour: "RGB";
  /**
   * The page count must be a multiple of this (e.g. 2 or 4 for some binders). 1 = any count.
   * Missing pages are filled with "My drawing" pages, never left blank.
   */
  pageCountMultiple: number;
}

// The generic print profile: used until the publisher's specification arrives. A common
// portrait children's-book size, the same shape as a page of the website's book (4:5):
// 8 × 10 inches (203 × 254 mm), 3 mm bleed, 12 mm safe margin, 300 dpi.
const generic: PrintProfile = {
  id: "generic",
  name: "Generic hardback (8 × 10 in portrait, until the publisher's spec arrives)",
  trimWidthMm: 203.2,
  trimHeightMm: 254,
  bleedMm: 3,
  safeMarginMm: 12,
  minDpi: 300,
  colour: "RGB",
  pageCountMultiple: 1,
};

// The PDF the parent downloads: the same pages, without bleed (nicer on a screen).
const digital: PrintProfile = {
  ...generic,
  id: "digital",
  name: "Digital PDF (8 × 10 in portrait, no bleed)",
  bleedMm: 0,
  // On a screen ~150 ppi already looks sharp.
  minDpi: 150,
};

export const PRINT_PROFILES = { generic, digital } as const satisfies Record<string, PrintProfile>;
export type PrintProfileId = keyof typeof PRINT_PROFILES;
export const PRINT_PROFILE_IDS = Object.keys(PRINT_PROFILES) as [PrintProfileId, ...PrintProfileId[]];

export function getPrintProfile(id: PrintProfileId): PrintProfile {
  return PRINT_PROFILES[id];
}

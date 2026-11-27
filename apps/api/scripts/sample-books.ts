// Sample storybooks as PDFs, to show Sami Bhai and publishers what a Dream Builder book looks like.
//
//   pnpm exec tsx scripts/sample-books.ts        (from apps/api)
//
// The TEXT comes from our real story pipeline (writeStoryText: the engine and its rules) with the
// stub AI, because there is no fal.ai key yet. The PICTURES are the sample artwork the website
// already shows (apps/web/src/assets), picked the same way the book screen picks them.
// Each PDF says so on every page. No database, no server: it only reads files and writes PDFs.
// Output: apps/api/data/sample-books/*.pdf (data/ is not committed).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { stubProvider } from "../src/ai/stubProvider.js";
import { buildContext, type StoryAnswers } from "../src/engine/index.js";
import type { StoryForAi } from "../src/jobs/providers.js";
import { writeStoryText } from "../src/jobs/storyText.js";

const here = dirname(fileURLToPath(import.meta.url));
const ASSETS = resolve(here, "../../web/src/assets");
const OUT = resolve(here, "../data/sample-books");
const LABEL = "Sample artwork and draft text, for illustration. Final books are written and illustrated by our AI for each child.";

interface Sample {
  file: string;
  title: string;
  dedication: string;
  answers: StoryAnswers;
}

const blank = { selfLove: "", oneMoreAmazingThing: "", thirdChallengeText: "", obstacles3: [], heartColor3: "", braveMove3: "", heroWords3: "" };

const SAMPLES: Sample[] = [
  {
    file: "01-zayd-the-knight",
    title: "Zayd and the Climb to the Stars",
    dedication: "A three-act adventure for a 9-year-old who dreams of space",
    answers: {
      ...blank,
      storyPath: "three_act",
      mode: "junior",
      heroType: "knight",
      charName: "Zayd",
      heroPronoun: "he",
      charTools: ["glasses"],
      charStrengths: ["brave-courage"],
      selfLove: "I always help my little brother",
      aspiration: "an astronaut who explores the stars",
      obstacles: ["grumpy-giant"],
      obstacles2: ["thundering-cloud"],
      obstacles3: ["mean-shadow"],
      heartColor: "heavy",
      heartColor2: "jumpy",
      heartColor3: "foggy",
      braveMove: "shrink-the-giant",
      braveMove2: "ask-for-help",
      braveMove3: "deep-breaths",
      heroWords: "I can do hard things",
      heroWords2: "One step at a time",
      heroWords3: "I am still here and I am still trying",
      safePlaceText: "the garden behind his grandmother's house",
    },
  },
  {
    file: "02-layla-the-fox",
    title: "Layla and the Healing Paws",
    dedication: "A two-act adventure for an 8-year-old who dreams of helping animals",
    answers: {
      ...blank,
      storyPath: "two_act",
      mode: "junior",
      heroType: "fox",
      charName: "Layla",
      heroPronoun: "she",
      charTools: ["hearing-aid"],
      charStrengths: ["kind-heart"],
      aspiration: "a vet who looks after animals",
      obstacles: ["humming-mist"],
      obstacles2: ["glass-wall"],
      heartColor: "foggy",
      heartColor2: "stuck",
      braveMove: "find-first-step",
      braveMove2: "lead-the-way",
      heroWords: "I will try anyway",
      heroWords2: "I know the way",
      safePlaceText: "the cosy window seat at home",
    },
  },
  {
    file: "03-omar-the-robot",
    title: "Omar and the Brilliant Blueprint",
    dedication: "A three-act adventure for an 11-year-old who loves to invent",
    answers: {
      ...blank,
      storyPath: "three_act",
      mode: "junior",
      heroType: "robot",
      charName: "Omar",
      heroPronoun: "he",
      charTools: ["wheelchair"],
      charStrengths: ["clever-inventions"],
      aspiration: "an inventor who builds helpful robots",
      obstacles: ["messy-blueprint"],
      obstacles2: ["roaring-fire"],
      obstacles3: ["mean-whispers"],
      heartColor: "thumpy",
      heartColor2: "fluttery",
      heartColor3: "exposed",
      braveMove: "try-something-new",
      braveMove2: "stand-my-ground",
      braveMove3: "calm-honesty",
      heroWords: "Mistakes help me learn",
      heroWords2: "I can stay calm",
      heroWords3: "My ideas matter",
      safePlaceText: "the quiet corner of the workshop",
    },
  },
];

// ---- Pictures: the same choices as the book screen (apps/web/src/components/Flipbook.tsx) ----

const STRENGTH_ART: Record<string, string> = { curious: "big-curiosity", empathetic: "kind-heart", inventive: "clever-inventions", focused: "super-focus", imaginative: "creative-vision", resilient: "brave-courage" };
const FEELING_POSE: Record<string, string> = { heavy: "sad", foggy: "sad", "shut-out": "sad", stuck: "sad", jumpy: "overwhelmed", thumpy: "overwhelmed", fluttery: "overwhelmed", exposed: "overwhelmed" };
const MOVE_POSE: Record<string, string> = { "ask-for-help": "speak", "lead-the-way": "speak", "shrink-the-giant": "curious", "find-first-step": "curious", "try-something-new": "dream", "stand-my-ground": "standing" };
const THREE_ACT_ORDER = ["identity", "gift", "call", "shadow1", "pivot1", "heavyHeart", "rest", "shadow2", "pivot2", "persistence", "plateau", "shadow3", "pivot3", "finale", "anchor"];

/** The first of these asset files that exists. */
function firstAsset(...paths: string[]): string {
  for (const p of paths) if (existsSync(join(ASSETS, p))) return join(ASSETS, p);
  return join(ASSETS, "scenes/gate.webp");
}

function pictureFor(role: string, a: StoryAnswers): string {
  const hero = a.heroType!;
  // A knight's book has full illustrated scenes for each part of the story.
  if (hero === "knight") return firstAsset(`panels/panel-${String(THREE_ACT_ORDER.indexOf(role) + 1).padStart(2, "0")}.webp`);
  const pose = (...poses: string[]) => firstAsset(...poses.map((p) => `heroes/${hero}/${p}.webp`), `heroes/${hero}/standing.webp`);
  const obstacle = (ids: string[], fallback: string) => (ids[0] ? firstAsset(`heroes/${hero}/obstacle-${ids[0]}.webp`, `obstacles/${ids[0]}.webp`) : pose(fallback));
  const feeling = (id: string, act: number) => (FEELING_POSE[id] ? pose(`feeling-${id}`, FEELING_POSE[id]) : pose(act === 2 ? "overwhelmed" : "sad"));
  const move = (id: string, act: number) =>
    id === "deep-breaths" ? pose("breathe") : id === "calm-honesty" ? pose("speak") : MOVE_POSE[id] ? pose(`move-${id}`, MOVE_POSE[id]) : pose(act === 2 ? "speak" : "breathe");
  const strength = STRENGTH_ART[a.charStrengths[0] ?? ""] ?? a.charStrengths[0] ?? "big-curiosity";
  const tool = a.charTools.at(-1);
  switch (role) {
    case "identity":
    case "plateau":
      return pose("standing");
    case "gift":
      return strength === "big-curiosity" ? pose("curious") : pose(`strength-${strength}`, "curious");
    case "call":
    case "finale":
      return pose("dream");
    case "shadow1":
      return obstacle(a.obstacles, "standing");
    case "pivot1":
      return move(a.braveMove, 1);
    case "heavyHeart":
      return feeling(a.heartColor, 1);
    case "rest":
      return pose("rest");
    case "shadow2":
      return obstacle(a.obstacles2, "overwhelmed");
    case "pivot2":
      return move(a.braveMove2, 2);
    case "persistence":
      return tool && tool !== "headphones" ? pose(`tools-${tool}`, "tools") : pose("tools");
    case "shadow3":
      return obstacle(a.obstacles3, "overwhelmed");
    case "pivot3":
      return move(a.braveMove3, 3);
    default:
      return pose("breathe");
  }
}

const dataUri = (file: string) => `data:image/webp;base64,${readFileSync(file).toString("base64")}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * The stub's draft text, tidied for reading: no "placeholder" note, past tense for the body
 * signal, articles and tools read naturally, sentences start with a capital and end with a stop.
 * (Grammar only: the story itself is exactly what the pipeline wrote.)
 */
function tidy(text: string, a: StoryAnswers): string {
  const his = a.heroPronoun === "she" ? "her" : "his";
  return text
    .replace(/\s*\(Placeholder story[^)]*\)\s*/g, " ")
    .replace(/\bhad kind heart\b/g, "had a kind heart")
    .replace(/\bhad clever inventions\b/g, "had a head full of clever inventions")
    .replace(/\bcarried (glasses|hearing aid) with (him|her)\b/g, `wore ${his} $1`)
    .replace(/\bcarried wheelchair with (him|her)\b/g, `rolled along in ${his} wheelchair`)
    .replace(/\bcarried (white cane|fidget toy) with (him|her)\b/g, `carried ${his} $1`)
    .replace(/\btail bristles\b/g, "tail bristled")
    .replace(/\bgears grind\b/g, "gears ground")
    .replace(/\bshield arm trembles\b/g, "shield arm trembled")
    .replace(/\bchose (\w+ing)\b/g, "chose to try $1")
    .replace(/"([^"]*[^.!?"])"/g, '"$1."')
    .replace(/(^|[.!?]["']?\s+)([a-z])/g, (_m, before: string, letter: string) => before + letter.toUpperCase())
    .trim();
}

// ---- The book ----------------------------------------------------------------------------------

function bookHtml(sample: Sample, pages: { number: number; label: string; act: number; text: string; picture: string }[]) {
  const cover = sample.answers.heroType === "knight" ? join(ASSETS, "panels/panel-14.webp") : firstAsset(`heroes/${sample.answers.heroType}/dream.webp`);
  const body = pages
    .map(
      (p) => `
  <section class="page">
    <div class="art"><img src="${dataUri(p.picture)}" alt=""></div>
    <div class="words">${tidy(p.text, sample.answers)
      .split(/\n+/)
      .map((line) => `<p>${esc(line)}</p>`)
      .join("")}</div>
    <footer><span>${p.number} · Act ${p.act} · ${esc(p.label)}</span><span>${esc(LABEL)}</span></footer>
  </section>`,
    )
    .join("");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(sample.title)}</title>
<style>
  @page { size: A4; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Georgia, "Times New Roman", serif; color: #2b2340; }
  .page, .cover { width: 210mm; height: 297mm; padding: 16mm 16mm 12mm; page-break-after: always; display: flex; flex-direction: column; }
  .cover { background: #fbf6ec; justify-content: center; align-items: center; text-align: center; }
  .cover img { width: 150mm; height: 150mm; object-fit: cover; border-radius: 8mm; box-shadow: 0 2mm 8mm rgba(0,0,0,.15); }
  .cover h1 { font-size: 30pt; margin: 12mm 0 4mm; line-height: 1.15; }
  .cover .sub { font: 12pt/1.4 Arial, sans-serif; color: #6b6280; }
  .cover .brand { font: bold 11pt Arial, sans-serif; letter-spacing: .2em; text-transform: uppercase; color: #7a5af8; margin-bottom: 10mm; }
  .cover .note { margin-top: 14mm; font: italic 9.5pt/1.4 Arial, sans-serif; color: #8a8199; max-width: 140mm; }
  .art { height: 165mm; border-radius: 6mm; overflow: hidden; background: #f3eefc; display: flex; align-items: center; justify-content: center; }
  .art img { width: 100%; height: 100%; object-fit: cover; }
  .words { flex: 1; padding: 9mm 4mm 0; font-size: 15pt; line-height: 1.55; }
  .words p { margin: 0 0 3mm; }
  footer { display: flex; justify-content: space-between; gap: 8mm; font: 8pt/1.3 Arial, sans-serif; color: #9a92a8; border-top: 0.3mm solid #e6e0ef; padding-top: 3mm; }
  footer span:last-child { text-align: right; max-width: 110mm; }
</style></head><body>
  <section class="cover">
    <div class="brand">Dream Builder</div>
    <img src="${dataUri(cover)}" alt="">
    <h1>${esc(sample.title)}</h1>
    <div class="sub">${esc(sample.dedication)}</div>
    <div class="note">${esc(LABEL)}</div>
  </section>${body}
</body></html>`;
}

function chromePath(): string {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ];
  const found = candidates.find((c) => c && existsSync(c));
  if (!found) throw new Error("No Chrome or Edge found; set CHROME_PATH");
  return found;
}

mkdirSync(OUT, { recursive: true });
const chrome = chromePath();
for (const sample of SAMPLES) {
  const story: StoryForAi = { id: sample.file, ...sample.answers };
  const ctx = buildContext(story);
  const { panels } = await writeStoryText(stubProvider, story);
  const pages = panels.map((p) => {
    const plan = ctx.plan.find((x) => x.number === p.number)!;
    return { number: p.number, label: plan.label, act: plan.act, text: p.text, picture: pictureFor(plan.role, sample.answers) };
  });
  const html = join(OUT, `${sample.file}.html`);
  const pdf = join(OUT, `${sample.file}.pdf`);
  writeFileSync(html, bookHtml(sample, pages));
  execFileSync(chrome, ["--headless=new", "--disable-gpu", "--no-pdf-header-footer", `--print-to-pdf=${pdf}`, pathToFileURL(html).href], { stdio: "ignore" });
  console.log(`${sample.title}: ${pages.length} pages → ${pdf}`);
}
process.exit(0);

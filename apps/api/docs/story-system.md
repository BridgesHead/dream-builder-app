# How the Dream Builder story system works

A guide for developers: what happens from the moment a child starts a story until it is ready
to read, the words we use, where each part lives in the code, and how to change it safely.

Stories covered: BE-04 (child sessions), BE-07 (job queue), BE-08 (drafts and wizard),
BE-09 (story rules engine). BE-10 (real AI) and BE-11 (comics) plug into the same shape.

---

## 1. The big picture in one minute

1. A **parent** signs up, adds a **child**, and **hands the device over** (a child session starts).
2. The **child** answers the **wizard**: hero, strength, dream, three challenges… Every answer is
   saved to a **draft** on the server as they go.
3. At the **Challenge Gate** the child picks **two acts** (12 pages) or **three acts** (15 pages).
4. On **Final Climb** the child taps "make my story". The server checks the draft is complete and
   puts **jobs** on a list. **Workers** do them in the background:
   - write the story text → the **engine** checks every rule → save the **panels**
   - draw one picture per panel
   - make the title
5. When every job is done, the story is ready: the child reads it (**child_review**), taps
   "I'm done!", and a parent reviews and approves it (BE-12).

```
 Parent ──► Child profile ──► Handover ──► Wizard (draft saved as they go)
                                                   │
                                           Challenge Gate (2 or 3 acts)
                                                   │
                                       Final Climb: POST /generate
                                                   │
                   ┌───────────────────── job queue ─────────────────────┐
                   │  story_text ──► ENGINE ──► panels saved            │
                   │       └──► panel_image × 12 or 15                   │
                   │  title                                              │
                   └─────────────────────────────────────────────────────┘
                                                   │
                         all jobs done ──► child_review ──► parent_review ──► approved
```

---

## 2. The words we use

### The story

| Word | What it means | Example |
|---|---|---|
| **Story** | One child's book, from the first answer to the finished pages. One document in the `stories` collection. | "Ember and the Big Dream" |
| **Draft** | A story the child is still answering. Status `draft`. | Ember's story after the dream step |
| **Answers** (StoryState) | Everything the child chose in the wizard, with the same field names as the frontend. | `heroType: "fox"`, `aspiration: "be a vet"` |
| **Mode** | **Explorer** (`junior`, usually under 12): simpler words, more guidance. **Creator** (`senior`, 12+): deeper choices. Stored on the child; copied onto each story when it starts. | Alex, 8 → Explorer |
| **Hero** | The story's main character: a **fox**, **robot** or **knight**. | Ember the Fox |
| **Hero name** | `charName` if the child typed one; otherwise the hero's default name; otherwise "Sparky". | "" + fox → "Ember" |
| **Pronoun** | `he` or `she` only. Used everywhere the story talks about the hero. | she / her / her |

### Acts and the Challenge Gate

| Word | What it means |
|---|---|
| **Act** | A big part of the story. Act 1: who the hero is and the first challenge. Act 2: the second challenge. Act 3: the greatest challenge. |
| **Challenge Gate** | The screen where the child decides whether the hero faces a third challenge. Saved as `facesChallenge3`. |
| **Story path** | The result of the gate: `three_act` (15 pages) or `two_act` (12 pages). The server sets `storyPath` from `facesChallenge3`; the client can't set it. |

### Panels

A **panel** is **one page** of the story: some text and one picture. A story is a row of panels.
Each panel has a **job** in the hero's journey (its **role**) and a **label** (its name):

| # | Label | Its job | Act |
|---|---|---|---|
| 1 | Identity Anchor | Who the hero is | 1 |
| 2 | Internal Gift | The hero's inner strength (and tools) | 1 |
| 3 | The Call | The dream | 1 |
| 4 | First Shadow | The first challenge appears | 1 |
| 5 | First Pivot | The first brave move (**8 beats**) | 1 |
| 6 | The Heavy Heart | The hero feels the weight of it and stays | 1 |
| 7 | Rest & Restoration | The hero rests in a safe place | 1 |
| 8 | Second Shadow | The second challenge appears | 2 |
| 9 | Second Brave Move | The second brave move (**8 beats**) | 2 |
| 10 | Persistence | Trying again and again | 2 |
| 11 | Plateau Triumph | A high point, earned through effort | 2 |
| 12 | Third Shadow / Deepest Pause | The greatest challenge and the lowest moment; ends with the child's Act 3 words | 3 |
| 13 | Final Pivot | The way through | 3 |
| 14 | Grand Finale | The hero's next brave step toward the dream | 3 |
| 15 | Practice Anchor | A message to the reader; always ends "One real step today." | 3 |

**Two-act stories (12 panels)** keep panels 1–10, then the Grand Finale (11) and the Practice
Anchor (12). They drop 12 and 13 (the third challenge) and 11 (Plateau Triumph), because
Plateau Triumph would repeat the Grand Finale that comes straight after it in a short story.
Decided by Anas; Sami Bhai to check it matches the prototype (`TWO_ACT_ROLES` in `src/engine/plan.ts`).

Words you'll see for panel kinds:

- **Shadow**: a panel where a challenge (obstacle) appears.
- **Pivot / brave move**: a panel where the hero tries something brave.
- **Comic cell** (BE-11): comics use *cells* instead of panels, 4 per page.

### Beats

A **beat** is **one small moment inside a panel**: one step of what happens, a sentence or two.
Story → panels (pages) → beats (moments).

The two brave-move panels (5 and 9) follow the **8-Beat Arc**, always in this order. Ember the
Fox meets the Grumpy Giant; the child's brave words are "I can start with one small step.":

| # | Beat | What happens | Example |
|---|---|---|---|
| 1 | **Trigger** | The challenge hits | The Grumpy Giant stomped onto the path. |
| 2 | **Metaphor** | The hero names it in their own words | "You are a wall made of thunder," Ember whispered. |
| 3 | **Signal** | The hero's body reacts (different per hero) | Her **tail bristled**. |
| 4 | **Try** | The first brave try, with **the child's exact words** | She called out, "I can start with one small step." |
| 5 | **Stumble** | It doesn't work yet | The Giant didn't move, and she slipped into the mud. |
| 6 | **Re-center** | The hero calms down, goes back to what helps | She pushed up her glasses and remembered her kind heart. |
| 7 | **Try Again** | A second, steadier try | Together with Pip the puppy, she took one careful step. |
| 8 | **Partial Shift** | It gets a bit better, **but the challenge is still there** | The Giant shuffled aside, still huge, but there was a way past. |

**Body signals** (beat 3): robot → **gears grind**, fox → **tail bristles**, knight → **shield arm trembles**.

**Resolution beat**: a moment where the challenge eases: beat 8 of panels 5 and 9, the Final
Pivot (13) and the Grand Finale (14). In a resolution beat the challenge **never disappears**:
the words *shattered, vanished, dissolved, fixed, solved, gone* are banned there (the
**Partial Shift** rule). The hero finds a way past; they don't destroy it.

### The child's own words

| Word | Field | Where it must appear |
|---|---|---|
| **One Brave Sentence** (Act 1) | `heroWords` | Word for word, in quotes, in the Try beat of Panel 5 |
| Act 2 brave words | `heroWords2` | Word for word, in quotes, in the Try beat of Panel 9 |
| Act 3 words | `heroWords3` | Word for word, in quotes, **at the very end of Panel 12**. Panel 13 echoes them in its own words, never word for word. |
| Act 3 reflection | `thirdChallengeText` | Creator mode, used in Act 3 |

**Rule of thumb:** the child's words are **never changed, never judged, never paraphrased**. The
engine leaves them out of every check and repair.

### Other story terms

| Word | What it means | Example |
|---|---|---|
| **Dream world** | Where the story is set, matching the dream | vet → clinic, animals, puppy |
| **Core Noun** | What the hero is becoming, in the Grand Finale | "be a vet" → "vet" |
| **Brave-Step Mandate** | The Grand Finale must say: "took **her/his** next brave step toward becoming the **[Core Noun]**" | "Ember took her next brave step toward becoming the vet." |
| **Practice Anchor tag** | The last panel always ends with **"One real step today."** | |
| **Earned Success** | Success comes from effort, never magic ("suddenly", "spell", "poof" are not allowed in triumph panels) | |
| **Inner voice** | The hero's thoughts use single quotes | 'Maybe I can,' Ember thought. |
| **Clinical label** | A medical or therapy word; never used in the story. We use a poetic name instead. | "anxiety" → "the Humming Mist" |
| **Bleed** | Details from another hero leaking in | a Fox story saying "Sparky" or "her gears ground" |
| **Garble** | Broken word mashes from the AI | "world-future Singer" |

### The machinery

| Word | What it means | Code |
|---|---|---|
| **Status** | Where the story is: `draft → generating → child_review → parent_review → approved`. Only allowed moves happen. | `src/services/storyLifecycle.ts` |
| **Job** | One piece of background work, e.g. "draw panel 3". One record in `jobs`. Types: `story_text`, `panel_image`, `title` (and later `comic_script`, `comic_cell_image`, `panel_redraw`). | `src/db/models/job.ts` |
| **Queue** | The to-do list of jobs. BullMQ + Redis, or in memory on a PC without Redis. | `src/jobs/queue.ts` |
| **Worker** | A program that takes jobs off the list and does them (`pnpm worker`). | `src/worker.ts` |
| **Try / attempt / retry** | Each job gets 3 tries, with growing waits in between. | `JOB_ATTEMPTS`, `JOB_BACKOFF_MS` |
| **Provider** | Who makes the words and pictures: **fal** (the real AI, BE-10) or the **stub** (fake, for tests). | `src/jobs/providers.ts`, `src/ai/` |
| **Scene Director** | The AI that describes what each picture shows. If it fails: the **Visual Brief** table, then **Universal Triumph** (recorded as a fallback). | `src/ai/falProvider.ts`, `src/engine/visual.ts` |
| **Character Blueprint** | The hero's fixed look on every picture (the robot's porthole eye and brass torso). | `src/engine/visual.ts` |
| **Seed** | A fixed number from hero name + dream, the same for every panel, so FLUX keeps the hero looking the same. | `seedFor`, `visual.ts` |
| **Stand-in name** | "Tibbo": what the AI sees instead of the hero's name when that name is one of the family's (BE-14); the real name is put back afterwards. A made-up hero name reaches the AI as it is. | `src/ai/prompts.ts` (`aiNameFor`) |
| **Engine** | The story rules checker. No HTTP, no database. | `src/engine/` |
| **Director** | The instructions the AI gets, panel by panel and beat by beat. | `src/engine/director.ts` |
| **Draft panel** | A panel as the AI sends it: `{ number, text }`, or `{ number, beats: [8 sentences] }` for panels 5 and 9. | `DraftPanel` |
| **Repair** | A small, certain fix the engine makes itself. | `src/engine/rules/repairs.ts` |
| **Check / rewrite** | A problem the engine can't fix safely; the AI rewrites **only that panel**. | `src/engine/rules/checks.ts` |
| **Violation** | A logged problem, saved on the job as `repaired`, `rewritten` or `failed`. Shown in Book Progress Detail. | `job.violations` |
| **Book Progress Detail** | The admin view of one story: per-panel status, every job, every violation. | `GET /admin/stories/:id/progress` |

---

## 3. The flow, step by step

### Step 1: draft (BE-08)

| Who | Call | What happens |
|---|---|---|
| Child | `POST /stories` | A new draft for the child in this session, in the child's mode |
| Child | `PATCH /stories/:id` | Saves one wizard step (only the changed fields). Every answer is checked: real option ids only, no "they", Creator-only answers refused on Explorer drafts. Choosing two acts clears Act 3. |
| Child or parent | `GET /stories`, `GET /stories/:id` | The library, and one story with every field |

### Step 2: start (BE-07)

`POST /stories/:id/generate`

1. The draft must be complete. Otherwise: **400 `STORY_INCOMPLETE`** with `missingSteps`
   (e.g. `["style", "act1.feeling"]`), and Final Climb sends the child back to the first one.
2. The story moves `draft → generating` (only once, even if the button is tapped twice).
3. Two jobs go on the list: `story_text` and `title`. Answer: **202**.

### Step 3: the story text and the engine (BE-09)

```
story_text job
  │
  ├─ 1. provider.storyText(answers)         the AI's first draft (DraftPanel[])
  │
  ├─ 2. runEngine(draft, context)
  │      a. lay it over the panel plan      missing/empty panel → rewrite (D5)
  │                                          extra panels → the try fails (never cut or padded)
  │      b. brave-move panels: the 8 beats  missing / empty / fused beats → rewrite (D4)
  │      c. repairs                          fixed by code, logged as "repaired"
  │      d. checks                           → list of panels to rewrite
  │
  ├─ 3. anything to rewrite?
  │      yes → provider.rewritePanels(only those panels) → back to 2   (at most 2 rounds)
  │      no  → save the panels, save the violations on the job
  │
  ├─ 4. still broken after 2 rounds → the try fails with the reason
  │      (the violations are saved as "failed"; the queue retries from scratch)
  │
  └─ 5. one panel_image job per panel goes on the list
```

### Step 4: pictures and title (BE-10)

- `panel_image` (one per panel): the Scene Director describes the picture (or the Visual Brief table, or
  Universal Triumph), FLUX draws it with the style, Character Blueprint, costume and seed, and we save
  **our own copy** as `stories/<id>/panel-03.png` (never a fal.ai link).
- `title`: "[Hero name] and the [poetic version of the dream]"; the formula if the AI's title has the wrong shape.

### Step 5: finished

When every job is done (`success` or `fallback`), the story moves `generating → child_review`.

Final Climb asks `GET /stories/:id/status` every 2 seconds:

```json
{ "status": "generating", "progress": 64,
  "panels": [{ "number": 1, "textStatus": "success", "imageStatus": "running" }, …],
  "failed": [], "canRetry": false }
```

If a job fails all 3 tries, `canRetry` is true and the child sees **"Try again"**
(`POST /stories/:id/generate/retry`).

---

## 4. The rules, with examples

✅ = what we want; ❌ = what the engine catches. 🔧 = fixed by code; 🔁 = panel rewritten.

| Rule | ❌ Caught | ✅ After | How |
|---|---|---|---|
| **R1** No clinical labels | "Her anxiety grew." | "Her Humming Mist grew." | 🔧 known words; 🔁 the rest (therapy, disorder…) |
| **R2** Dream world | Panel 3: "She dreamed of far mountains." (dream: vet) | "…a puppy with a shiny stethoscope…" | 🔁 key panels 3, 11, 14 |
| **R3** Earned, not magic | "Suddenly, with a flick of magic, she was there." | "Step by step, she reached the clinic." | 🔁 |
| **R4** Child's Act 3 words | Panel 12 without them | Panel 12 ends `"I can keep going one step at a time."` | 🔧 |
|  | Panel 13 repeats them word for word | Panel 13 echoes them in its own words | 🔁 |
| **R5** Inner voice | `"Maybe I can," Ember thought.` | `'Maybe I can,' Ember thought.` | 🔧 |
| **R6** Same hero all through | Panel 1 doesn't name Ember; her glasses never appear | Ember named; glasses mentioned | 🔁 |
| **R7** One Brave Sentence | Try beat without the child's words | `Ember said, "I can start with one small step."` | 🔧 |
| **R8** Different brave moves | Panel 9 copies Panel 5's Try → Try Again | A new action in Panel 9 | 🔁 |
| **R9** Practice Anchor | Last panel ends anywhere | "…One real step today." | 🔧 |
| **R10** Brave-Step Mandate | Grand Finale without the phrase | "Ember took her next brave step toward becoming the vet." | 🔧 |
| **8-Beat Arc** (D4) | Re-center and Try Again empty or the same | All 8 beats, in order | 🔁 |
| **Body signal** | Fox's Signal beat: "her ears twitched" | "her tail bristled" | 🔁 |
| **Partial Shift** | Beat 8: "The Giant vanished." | "The Giant shuffled aside, still there." | 🔁 |
| **D3** Bleed-guard | "Sparky", or "Ember's gears ground" | Only Ember's own name, body and tools | 🔁 + reason reaches the status |
| **D5** Missing panel | Panel 6 left out | Panel 6 rewritten | 🔁 |
| **D6** Strategy label | "Using the One Brave Sentence strategy…" | "Using brave words…" | 🔧 |
| **D7** Pronoun case | "leaving she tired" | "leaving her tired" | 🔧 |
| **D9** Garble | "her world-future Singer dreams" | Plain, correct words | 🔁 |
| **Two acts** | "…then one last challenge appeared." | No third challenge | 🔁 |

---

## 5. Where everything lives

```
src/
  engine/                      the story rules engine: NO http, NO database
    plan.ts                    panel plans (15 / 12), labels, roles, beat panels
    context.ts                 one story's facts: hero name, pronoun, Core Noun, dream world, child's words
    tables.ts                  word tables: clinical words, dream worlds, body signals, banned words…
    text.ts                    small text helpers (quotes, "is this word for word?")
    types.ts                   rule names, Finding, DraftPanel, EngineResult
    rules/repairs.ts           fixes made by code
    rules/checks.ts            problems sent back for a rewrite
    director.ts                the AI's instructions, panel by panel
    visual.ts                  picture rules: style, blueprint, costume, scenes, seed
    index.ts                   runEngine(): plan → beats → repairs → checks
  jobs/
    queue.ts                   the job list (BullMQ or in memory); the ONLY file that knows BullMQ
    runJob.ts                  one try of one job; one handler per job type
    storyText.ts               AI draft → engine → rewrites (max 2) → violations
    providers.ts               who writes and draws: fal or stub (the shape both follow)
  ai/
    falClient.ts               the one door to fal.ai
    prompts.ts                 the AI's messages (PROMPT_VERSION), hiding the hero's name
    storyJson.ts               reading the AI's JSON (exactly the planned panels, else retry)
    falProvider.ts             the real AI
    stubProvider.ts            the fake AI for tests
  services/
    stories.ts                 drafts, saving steps, reading, starting generation
    storyRules.ts              draft rules: mode, Challenge Gate, missing steps
    generation.ts              start, retry, "is it finished?", status, Book Progress Detail
    storyLifecycle.ts          which status changes are allowed
  worker.ts                    the worker program (pnpm worker)
tests/
  fixtures/engine/samples.ts   fixed sample stories (a good one; tests break one thing each)
  unit/engine/                 rules, defects, guide checks, plan, context, director
  integration/generation.test.ts     the whole pipeline, with the stub AI
  integration/falGeneration.test.ts  the fal provider against a fake fal.ai server
```

---

## 6. How to build on it properly

### Golden rules

1. **Keep the engine pure.** No `fetch`, no Mongoose, no `req`/`res` in `src/engine/`. Text in, text out.
   That's why every rule can be tested in milliseconds with no AI calls.
2. **Never change the child's words.** Use `outsideChildWords()` for repairs and
   `withoutChildWords()` for checks.
3. **Never pad or cut panels.** Wrong count → the try fails. Missing panel → that panel is rewritten.
4. **Repair only what is certain.** If a fix could change the meaning, make it a check (rewrite).
5. **One place per decision.** Panel plans in `plan.ts`, words in `tables.ts`, status moves in
   `storyLifecycle.ts`, the queue library in `queue.ts`.
6. **Every rule has a test**: a known-bad sample is caught, and after the fix it passes.
7. **Only the provider talks to the AI**, and from BE-14 only through the anonymising gate.
   Workers and the engine never call fal.ai directly.

### Add a new rule

1. Decide: **repair** (certain, small) or **check** (needs a rewrite)?
2. Add its name to `RULES` in `src/engine/types.ts`.
3. Write it:
   - repair → a function in `rules/repairs.ts` that changes `panel.text` and returns findings,
     then call it in `runEngine()` (`index.ts`);
   - check → a function in `rules/checks.ts` that returns findings, then add it to `CHECKS`.
4. Put any word lists in `tables.ts`, not inside the rule.
5. Test it in `tests/unit/engine/`:

```ts
it("my rule catches the bad thing", () => {
  const result = runOn((d) => (panel(d, 6).text = "a sentence that breaks the rule"));
  expect(result.rewrite).toEqual([expect.objectContaining({ rule: "MY_RULE", panelNumber: 6 })]);
});
it("the good sample still passes", () => {
  expect(runOn().rewrite).toEqual([]);
});
```

6. Tell the AI about it in `director.ts`, so it gets it right the first time.

### Change a table (e.g. the prototype's tables arrive)

Edit `src/engine/tables.ts` only: `CLINICAL_WORDS`, `DREAM_WORLDS`, `BODY_SIGNALS`… The rules
read the tables, so they don't change. Run `pnpm test:unit`; if a sample breaks, the new table is
stricter, so update the sample or the table on purpose.

### Change the two-act plan (when Sami Bhai answers)

Edit `TWO_ACT_ROLES` in `src/engine/plan.ts`. If the count changes, also change `PANEL_COUNT` in
`src/types/story.ts`. Then update `EMBER_TWO_ACT_DRAFT` in the samples and run the tests.

### Add a new hero type

1. `HERO_TYPES` in `src/types/story.ts` (and the frontend's `content.ts`).
2. In `tables.ts`: `HERO_DEFAULT_NAMES`, `BODY_SIGNALS` (beat 3) and `HERO_PARTS` (bleed-guard).
3. A test: the new hero's Signal beat passes, and another hero's signal is caught.

### Change the AI (done in BE-10: `src/ai/falProvider.ts`)

Any provider has the same four methods:

| Method | Must return |
|---|---|
| `storyText(story)` | `DraftPanel[]`: exactly the planned panels; panels 5 and 9 as `beats: [8 strings]` |
| `rewritePanels(story, requests, current)` | `DraftPanel[]` for only the requested panels; `requests[].reasons` explains what to fix |
| `title(story)` | the title |
| `panelImage(story, n, text)` | the picture's bytes; `runJob` saves them in **our** storage |

Prompts live in `src/ai/prompts.ts` (built from `directStory`). When you change their wording, raise
`PROMPT_VERSION`. Bad JSON or a wrong panel count → throw, and the queue retries. The engine, the rewrite loop, the
queue and the status endpoint don't change.

### Before you call a story "done"

- `pnpm lint`, `pnpm typecheck`, `pnpm test` all pass.
- New routes are in the access matrix (`tests/integration/accessMatrix.test.ts`).
- Each acceptance criterion in the guide has a test.
- Break the new code on purpose once and check a test fails.
- README and this guide are updated.

---

## 7. Still open (waiting for Sami Bhai)

| Question | What we use now | Where to change it |
|---|---|---|
| Does the two-act plan match the prototype? (Decided: 1–10 + Grand Finale + Practice Anchor) | That plan | `TWO_ACT_ROLES`, `plan.ts` |
| Eight beats in Panels "5 and 8" (guide) or 5 and 9? | 5 and 9 | `BEAT_ROLES`, `plan.ts` |
| How the Core Noun is made | "be a vet" → "vet"; actions → dream-world noun; else "dreamer" | `coreNounFor()`, `context.ts` |
| The prototype's clinical-word and dream-world tables | Starter tables | `tables.ts` |
| Can a failed story go back to `draft`? | It waits in `generating` with "Try again" | `storyLifecycle.ts` |

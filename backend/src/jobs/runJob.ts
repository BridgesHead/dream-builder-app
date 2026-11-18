import { randomUUID } from "node:crypto";
import { Job, Story } from "../db/models/index.js";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { ensureJob, finishIfDone } from "../services/generation.js";
import { PANEL_COUNT, type StoryPath } from "../types/story.js";
import { getProvider, type AiResult, type StoryForAi } from "./providers.js";
import { StoryRulesError, writeStoryText } from "./storyText.js";
import type { Attempt } from "./queue.js";

// Runs ONE try of ONE job (guide BE-07). The queue calls this; throwing tells the queue the
// try failed, so it retries if tries are left.
//
// Safe to run twice: every handler writes to its own place (the panel with its number, the
// title), so a retry overwrites its own result and never adds a second panel.

type JobDoc = NonNullable<Awaited<ReturnType<typeof Job.findOne>>>;

interface Handler {
  timeoutMs: () => number;
  /** Before the AI call, e.g. show "running" on the panel. */
  onStart?(job: JobDoc): Promise<void>;
  /** The AI call, then saving its result on the story. Returns what to record on the job. */
  run(job: JobDoc, story: StoryForAi): Promise<Omit<AiResult<unknown>, "value">>;
  /** After the last try failed, e.g. show "failed" on the panel. */
  onFail?(job: JobDoc): Promise<void>;
}

const panelFilter = (job: JobDoc) => ({ _id: job.storyId, "panels.number": job.panelNumber });

const HANDLERS: Partial<Record<JobDoc["type"], Handler>> = {
  // Writes the text of every panel through the story engine (BE-09), then queues one
  // picture job per panel. What the engine found is saved on the job (Book Progress Detail).
  story_text: {
    timeoutMs: () => config.queue.textTimeoutMs,
    async run(job, story) {
      let result: Awaited<ReturnType<typeof writeStoryText>>;
      try {
        result = await writeStoryText(getProvider(), story);
      } catch (err) {
        // Still broken after the rewrites: keep what the engine found, then fail this try.
        if (err instanceof StoryRulesError) await Job.updateOne({ _id: job._id }, { $set: { violations: err.violations } });
        throw err;
      }
      await Job.updateOne({ _id: job._id }, { $set: { violations: result.violations } });
      const expected = PANEL_COUNT[story.storyPath];
      // A retry after the panels were saved must not wipe pictures already drawn.
      const saved = await Story.findById(job.storyId, { panels: 1 }).lean();
      if (saved?.panels.length !== expected) {
        const panels = result.panels.map((p) => ({ number: p.number, text: p.text, textStatus: "success", imageStatus: "queued" }));
        await Story.updateOne({ _id: job.storyId }, { $set: { panels } });
      }
      for (let n = 1; n <= expected; n += 1) await ensureJob(String(job.storyId), "panel_image", n);
      return result;
    },
  },

  title: {
    timeoutMs: () => config.queue.textTimeoutMs,
    async run(job, story) {
      const result = await getProvider().title(story);
      await Story.updateOne({ _id: job.storyId }, { $set: { title: result.value } });
      return result;
    },
  },

  panel_image: {
    timeoutMs: () => config.queue.imageTimeoutMs,
    async onStart(job) {
      await Story.updateOne(panelFilter(job), { $set: { "panels.$.imageStatus": "running" } });
    },
    async run(job, story) {
      const result = await getProvider().panelImage(story, job.panelNumber!);
      await Story.updateOne(panelFilter(job), {
        $set: { "panels.$.imageKey": result.value, "panels.$.imageStatus": result.fallback ? "fallback" : "success" },
      });
      return result;
    },
    async onFail(job) {
      await Story.updateOne(panelFilter(job), { $set: { "panels.$.imageStatus": "failed" } });
    },
  },
  // comic_script and comic_cell_image arrive in BE-11, panel_redraw in BE-12.
};

class Timeout extends Error {}

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Timeout(`Took longer than ${Math.round(ms / 1000)}s`)), ms);
  });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

// A short, safe reason for the job record (never a stack trace).
const reasonOf = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 500);

export async function runJob(jobId: string, { attempt, isLastAttempt }: Attempt): Promise<void> {
  const runId = randomUUID();
  // Claim the job for this try. "running" is included for a crashed worker's job being
  // retried. Already finished or failed (e.g. delivered twice)? Nothing to do: a failed job
  // only runs again through the retry route, which puts it back to "queued" first.
  const job = await Job.findOneAndUpdate(
    { _id: jobId, status: { $in: ["queued", "running"] } },
    { $set: { status: "running", runId }, $inc: { attempts: 1 } },
    { returnDocument: "after" },
  );
  if (!job) return;
  // Only this try may write the outcome (see runId in the job model).
  const mine = { _id: job._id, runId };

  const handler = HANDLERS[job.type];
  const story = await Story.findById(job.storyId).lean();
  if (!handler || !story || story.status !== "generating" || !story.storyPath) {
    const reason = !handler ? `"${job.type}" jobs aren't built yet` : "The story isn't being generated any more";
    await Job.updateOne(mine, { $set: { status: "failed", error: reason } });
    return; // retrying wouldn't help
  }

  const started = Date.now();
  try {
    await handler.onStart?.(job);
    // The child's answers, as the story engine and the AI need them.
    const forAi: StoryForAi = {
      id: String(story._id),
      storyPath: story.storyPath as StoryPath,
      mode: story.mode,
      heroType: story.heroType ?? null,
      charName: story.charName,
      heroPronoun: story.heroPronoun ?? null,
      charTools: story.charTools,
      charStrengths: story.charStrengths,
      selfLove: story.selfLove,
      oneMoreAmazingThing: story.oneMoreAmazingThing,
      aspiration: story.aspiration,
      obstacles: story.obstacles,
      obstacles2: story.obstacles2,
      obstacles3: story.obstacles3,
      heartColor: story.heartColor,
      heartColor2: story.heartColor2,
      heartColor3: story.heartColor3,
      braveMove: story.braveMove,
      braveMove2: story.braveMove2,
      braveMove3: story.braveMove3,
      heroWords: story.heroWords,
      heroWords2: story.heroWords2,
      heroWords3: story.heroWords3,
      safePlaceText: story.safePlaceText,
      thirdChallengeText: story.thirdChallengeText,
    };
    const result = await withTimeout(handler.run(job, forAi), handler.timeoutMs());
    await Job.updateOne(mine, {
      $set: {
        status: result.fallback ? "fallback" : "success",
        provider: result.provider,
        aiModel: result.aiModel,
        durationMs: Date.now() - started,
        error: null,
      },
    });
    await finishIfDone(String(job.storyId));
  } catch (err) {
    const reason = reasonOf(err);
    logger.warn({ jobId, type: job.type, attempt, isLastAttempt, reason }, "Job try failed");
    if (isLastAttempt) {
      await Job.updateOne(mine, { $set: { status: "failed", error: reason, durationMs: Date.now() - started } });
      await handler.onFail?.(job);
    } else {
      // Back in line for the next try; the reason stays visible meanwhile.
      await Job.updateOne(mine, { $set: { status: "queued", error: reason } });
    }
    throw err;
  }
}

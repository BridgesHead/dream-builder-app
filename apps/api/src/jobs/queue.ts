import { Queue, Worker } from "bullmq";
import type { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "../lib/logger.js";
import { createRedisConnection } from "../lib/redis.js";

// THE job queue (guide BE-07). This is the ONLY file that knows which queue library we use,
// so if Sami Bhai picks a different one, only this file changes.
//
// Two versions with the same behaviour (retries with growing waits, a concurrency limit and
// an AI-call rate limit):
//   - BullMQ + Redis (REDIS_URL set): jobs live in Redis and survive restarts; workers run
//     as their own program (pnpm worker). Used on CI, dev, staging and production.
//   - In memory (no REDIS_URL, your PC only): jobs run inside the API process. A restart
//     forgets the list, so startup puts unfinished jobs back (recoverJobs in generation.ts).
//
// The list only holds the id of each job's record in MongoDB (the jobs collection); the
// record holds everything else, including its status.

export interface Attempt {
  /** 1 for the first try, 2 for the first retry, ... */
  attempt: number;
  /** No retry follows if this try fails. */
  isLastAttempt: boolean;
}
/** Does one job. Throwing means "this try failed": the queue retries it if tries are left. */
export type Processor = (jobId: string, attempt: Attempt) => Promise<void>;

export interface WorkerOptions {
  /** How long a worker may hold a job before it counts as crashed (BullMQ only). Tests make it short. */
  lockDurationMs?: number;
  /** How often to look for crashed workers' jobs (BullMQ only). */
  stalledIntervalMs?: number;
}

export interface RunningWorker {
  /** Stops taking jobs. force = drop the jobs in hand at once, as if the worker crashed. */
  close(force?: boolean): Promise<void>;
}

interface Driver {
  readonly name: "bullmq" | "memory";
  add(jobId: string, key: string, delayMs?: number): Promise<void>;
  startWorker(processor: Processor, options?: WorkerOptions): RunningWorker;
  close(): Promise<void>;
}

// In tests every run gets its own list, so leftovers from one test file never reach another.
const QUEUE_NAME = config.nodeEnv === "test" ? `generation-test-${process.pid}-${Date.now()}` : "generation";

// ---- BullMQ + Redis --------------------------------------------------------------------

class BullDriver implements Driver {
  readonly name = "bullmq";
  private connection: Redis = createRedisConnection();
  private queue = new Queue(QUEUE_NAME, { connection: this.connection });

  async add(jobId: string, key: string, delayMs = 0): Promise<void> {
    // `jobId: key`: BullMQ ignores a second add with the same key, so a job can't be queued twice.
    await this.queue.add(
      "job",
      { jobId },
      {
        jobId: key,
        ...(delayMs > 0 && { delay: delayMs }),
        attempts: config.queue.attempts,
        backoff: { type: "exponential", delay: config.queue.backoffMs },
        // Keep some finished entries for debugging; the full record is in MongoDB anyway.
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 5000 },
      },
    );
  }

  startWorker(processor: Processor, options: WorkerOptions = {}): RunningWorker {
    const worker = new Worker(
      QUEUE_NAME,
      async (job) => {
        const attempt = job.attemptsMade + 1;
        await processor(String(job.data.jobId), { attempt, isLastAttempt: attempt >= (job.opts.attempts ?? 1) });
      },
      {
        connection: createRedisConnection(),
        concurrency: config.queue.concurrency,
        // At most N jobs START per second (fal.ai rate limits). BullMQ shares this limit
        // across every worker on the queue, so more workers never means more fal.ai calls.
        limiter: { max: config.queue.aiCallsPerSecond, duration: 1000 },
        // If a worker dies mid-job, its lock runs out and another worker retries the job.
        ...(options.lockDurationMs && { lockDuration: options.lockDurationMs }),
        ...(options.stalledIntervalMs && { stalledInterval: options.stalledIntervalMs }),
      },
    );
    worker.on("error", (err) => logger.error({ err }, "Queue worker problem"));
    return { close: (force = false) => worker.close(force) };
  }

  async close(): Promise<void> {
    await this.queue.close();
    await this.connection.quit().catch(() => undefined);
  }
}

// ---- In memory (your PC only) ----------------------------------------------------------

interface Waiting {
  jobId: string;
  key: string;
  attempt: number;
}

class MemoryDriver implements Driver {
  readonly name = "memory";
  private waiting: Waiting[] = [];
  private known = new Set<string>(); // keys queued, running or waiting to retry
  private active = 0;
  private lastStart = 0;
  private processor: Processor | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();

  async add(jobId: string, key: string, delayMs = 0): Promise<void> {
    if (this.known.has(key)) return; // already queued: never twice
    this.known.add(key);
    const start = () => {
      this.waiting.push({ jobId, key, attempt: 1 });
      this.pump();
    };
    if (delayMs > 0) this.later(start, delayMs);
    else start();
  }

  startWorker(processor: Processor): RunningWorker {
    this.processor = processor;
    this.pump();
    return {
      close: async () => {
        this.processor = null;
      },
    };
  }

  private later(fn: () => void, ms: number): void {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      fn();
    }, ms);
    this.timers.add(timer);
  }

  // Starts waiting jobs while there is room (concurrency) and the rate limit allows.
  private pump(): void {
    while (this.processor && this.active < config.queue.concurrency && this.waiting.length > 0) {
      const gap = 1000 / config.queue.aiCallsPerSecond;
      const wait = this.lastStart + gap - Date.now();
      if (wait > 0) {
        this.later(() => this.pump(), wait);
        return;
      }
      this.run(this.waiting.shift()!, this.processor);
    }
  }

  private run(item: Waiting, processor: Processor): void {
    this.active += 1;
    this.lastStart = Date.now();
    const isLastAttempt = item.attempt >= config.queue.attempts;
    processor(item.jobId, { attempt: item.attempt, isLastAttempt })
      .then(() => this.known.delete(item.key))
      .catch(() => {
        if (isLastAttempt) {
          this.known.delete(item.key);
          return;
        }
        // Retry after a growing wait: backoff, then 2x, then 4x ...
        const delay = config.queue.backoffMs * 2 ** (item.attempt - 1);
        this.later(() => {
          this.waiting.push({ ...item, attempt: item.attempt + 1 });
          this.pump();
        }, delay);
      })
      .finally(() => {
        this.active -= 1;
        this.pump();
      });
  }

  async close(): Promise<void> {
    this.processor = null;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers.clear();
    this.waiting = [];
    this.known.clear();
    // Let jobs already running finish (at most a few seconds).
    for (let i = 0; i < 200 && this.active > 0; i += 1) await new Promise((r) => setTimeout(r, 25));
  }
}

// ---- The one queue this process uses ---------------------------------------------------

let driver: Driver | null = null;

function getDriver(): Driver {
  driver ??= config.redisUrl ? new BullDriver() : new MemoryDriver();
  return driver;
}

/** "bullmq" or "memory". */
export function queueKind(): Driver["name"] {
  return config.redisUrl ? "bullmq" : "memory";
}

/**
 * Puts a job on the list. `key` makes it unique: adding the same key again does nothing.
 * Normally the job's MongoDB id; a manual retry uses a new key so it runs again.
 */
export function enqueueJob(jobId: string, key: string = jobId, options: { delayMs?: number } = {}): Promise<void> {
  return getDriver().add(jobId, key, options.delayMs);
}

/**
 * The jobs on the list are story jobs (a jobs-collection id) or, from BE-16, deletion jobs
 * ("deletion-<deletionRequest id>"). The worker sends each to the right runner (jobs/dispatch.ts).
 */
export const DELETION_JOB_PREFIX = "deletion-"; // BullMQ ids may not contain ":"

/** Starts taking jobs from the list (the worker program, or the API itself in memory mode). */
export function startWorker(processor: Processor, options?: WorkerOptions): RunningWorker {
  return getDriver().startWorker(processor, options);
}

export async function closeQueue(): Promise<void> {
  if (driver) await driver.close();
  driver = null;
}

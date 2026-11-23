import { config } from "./config.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/connect.js";
import { closeQueue, startWorker } from "./jobs/queue.js";
import { recoverDeletions } from "./jobs/deletionJob.js";
import { processJob } from "./jobs/dispatch.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";

// The WORKER program (guide BE-07): takes jobs off the Redis list and does them, apart from
// the API. Start one or more with:  pnpm worker
//
// Without REDIS_URL there is no shared list: the API runs jobs itself (your PC only).

if (!config.redisUrl) {
  logger.fatal("REDIS_URL is not set. Without Redis the API runs the jobs itself, so no worker is needed.");
  process.exit(1);
}

try {
  await connectToDatabase(config.mongodbUri);
} catch (err) {
  logger.fatal({ err }, "Could not connect to MongoDB. Is the MongoDB service running?");
  process.exit(1);
}

const worker = startWorker(processJob);
// A deletion whose queue entry got lost (e.g. Redis was down when the parent asked) is put
// back; running one twice is safe (BE-16).
await recoverDeletions();
logger.info({ concurrency: config.queue.concurrency, aiCallsPerSecond: config.queue.aiCallsPerSecond }, "Dream Builder worker started");

// A polite stop: finish the jobs in hand, then close. (A crash instead leaves them locked;
// after the lock runs out another worker retries them.)
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Worker shutting down");
  await worker.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

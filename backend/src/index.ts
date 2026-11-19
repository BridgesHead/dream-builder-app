import { config } from "./config.js";
import { createApp } from "./app.js";
import { connectToDatabase, disconnectFromDatabase } from "./db/connect.js";
import { closeQueue, queueKind, startWorker } from "./jobs/queue.js";
import { recoverDeletions } from "./jobs/deletionJob.js";
import { processJob } from "./jobs/dispatch.js";
import { logger } from "./lib/logger.js";
import { closeRedis } from "./lib/redis.js";
import { recoverJobs } from "./services/generation.js";

// Order matters: connect to the database FIRST, then open the door to requests.
// If MongoDB is down we stop here, instead of running a server that fails on every request.
try {
  await connectToDatabase(config.mongodbUri);
  logger.info("MongoDB connected");
} catch (err) {
  logger.fatal({ err }, "Could not connect to MongoDB. Is the MongoDB service running?");
  process.exit(1);
}

// Background jobs (BE-07). With Redis, separate workers do them (pnpm worker). Without Redis
// (your PC), this process does them itself, and first puts back jobs a restart interrupted.
if (queueKind() === "memory") {
  startWorker(processJob);
  await recoverJobs();
  await recoverDeletions();
  logger.warn("No REDIS_URL: story jobs run inside the API (fine on your PC, not allowed in production)");
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info({ port: config.port, version: config.version }, "Dream Builder API listening");
});

// Ctrl+C (SIGINT) or a stop from the host (SIGTERM): close things politely.
// Stop taking new requests, then close the database connection, then exit.
async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close();
  await closeQueue();
  await closeRedis();
  await disconnectFromDatabase();
  process.exit(0);
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

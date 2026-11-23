import { Redis } from "ioredis";
import { config } from "../config.js";
import { logger } from "./logger.js";

// One shared Redis connection (BE-07), used by the job queue and the rate limits.
// Only when REDIS_URL is set; on a PC without Redis everything stays in memory.

let shared: Redis | null = null;

// A new connection. BullMQ needs maxRetriesPerRequest: null (it waits for Redis instead of
// failing a command when the connection drops for a moment).
export function createRedisConnection(): Redis {
  if (!config.redisUrl) throw new Error("REDIS_URL is not set");
  const connection = new Redis(config.redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (err) => logger.error({ err }, "Redis connection problem"));
  return connection;
}

export function getRedis(): Redis {
  shared ??= createRedisConnection();
  return shared;
}

export async function closeRedis(): Promise<void> {
  if (shared) await shared.quit().catch(() => undefined);
  shared = null;
}

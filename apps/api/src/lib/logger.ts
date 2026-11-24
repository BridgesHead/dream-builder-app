import { pino } from "pino";
import { config } from "../config.js";

// Field names that must NEVER appear in a log, wherever they are inside the object
// (top level, or one or two levels deep, e.g. { body: { password } }).
const SECRET_KEYS = [
  "password",
  "currentPassword",
  "newPassword",
  "passwordHash",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "cookie",
  "mongodbUri",
];
const redactPaths = SECRET_KEYS.flatMap((key) => [key, `*.${key}`, `*.*.${key}`]);

// One shared logger for the whole app. Every line it writes is one JSON object:
//   {"level":30,"time":1763290000000,"msg":"MongoDB connected"}
// JSON is easy for AWS log search to filter, e.g. "show every line with statusCode 500".
export const logger = pino({
  // "info" by default. In tests we stay silent so test output stays clean.
  level: config.nodeEnv === "test" ? "silent" : config.logLevel,
  // Any secret field is replaced with "[Redacted]" before the line is written.
  redact: { paths: redactPaths, censor: "[Redacted]" },
  // On your PC only: pino-pretty turns the JSON into colourful, readable lines.
  // On dev/staging/prod we keep raw JSON for the log search.
  ...(config.nodeEnv === "development" && {
    transport: { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
  }),
});

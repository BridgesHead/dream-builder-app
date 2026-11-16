// Fills your LOCAL database with the Sprint 1 test data.
//   pnpm seed
// It deletes everything in the database named in MONGODB_URI first.
import { config } from "../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../src/db/connect.js";
import { SEED_PARENT, seedDatabase } from "../src/db/seed.js";
import { logger } from "../src/lib/logger.js";

// The seed wipes the database, so it must never run against real families' data.
if (config.isProduction) {
  logger.fatal("Refusing to seed: NODE_ENV is production");
  process.exit(1);
}

await connectToDatabase(config.mongodbUri);
try {
  const result = await seedDatabase();
  logger.info(
    { parent: SEED_PARENT.email, children: ["Alex (8, junior)", "Maya (14, senior)"], stories: result.storyIds.length },
    `Seeded. Log in as ${SEED_PARENT.email} / ${SEED_PARENT.password} once BE-03 is built`,
  );
} finally {
  await disconnectFromDatabase();
}

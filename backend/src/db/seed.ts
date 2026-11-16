import { hashPassword } from "../lib/password.js";
import mongoose from "mongoose";
import { ALL_MODELS, Child, Consent, Story, User } from "./models/index.js";
import type { StoryFields } from "./models/story.js";

// The same test data as the Sprint 1 fixtures (frontend src/screens/ScreenIndex.tsx and
// TESTING.md), so the frontend looks the same on real data (guide BE-02).
export const SEED_PARENT = { name: "Sarah Jenkins", email: "parent@example.com", password: "DreamTest123" };

// DEMO_STORY's answers from ScreenIndex.tsx. Seeded as a complete three-act DRAFT
// (facesChallenge3 is true, so storyPath is three_act): ready to generate once BE-10
// exists. That's why storyGeneratedAt is null and confirmedByChild is false here.
const DEMO_ANSWERS: Partial<StoryFields> = {
  selectedFormat: "storybook",
  comicVibe: "clear-bold",
  heroType: "knight",
  charName: "Pip",
  heroPronoun: "he",
  charStrengths: ["big-curiosity"],
  selfLove: "kind to everyone",
  charTools: ["headphones"],
  aspiration: "Build a cloud flying machine",
  obstacles: ["roaring-fire"],
  heartColor: "heavy",
  braveMove: "deep-breaths",
  heroWords: "I can start with one small step.",
  safePlaceText: "Cuddling a pet",
  obstacles2: ["mean-shadow"],
  heartColor2: "heavy",
  braveMove2: "calm-honesty",
  heroWords2: "I'll try another way.",
  facesChallenge3: true,
  obstacles3: ["messy-blueprint"],
  heartColor3: "steady",
  braveMove3: "find-first-step",
  heroWords3: "I can keep going one step at a time.",
  storyPath: "three_act",
};

export interface SeedResult {
  parentId: string;
  childIds: { alex: string; maya: string };
  storyIds: string[];
}

// EMPTIES the connected database, then fills it with the fixture data.
// Safe to run again and again: every run gives the same result.
// Callers must make sure they are not connected to production (scripts/seed.ts checks).
export async function seedDatabase(): Promise<SeedResult> {
  const db = mongoose.connection.db;
  if (!db) throw new Error("Not connected to MongoDB");

  // Start from nothing, then rebuild every index (unique email, stories by child, ...).
  await db.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));

  const parent = await User.create({
    name: SEED_PARENT.name,
    email: SEED_PARENT.email,
    passwordHash: await hashPassword(SEED_PARENT.password),
    role: "parent",
    emailVerifiedAt: new Date(),
  });

  await Consent.create({
    parentId: parent._id,
    textVersion: "seed-v1",
    method: "email_verification",
    ipAddress: "127.0.0.1",
  });

  // Mode comes from age: Alex (8) is an Explorer, Maya (14) is a Creator.
  const alex = await Child.create({ parentId: parent._id, name: "Alex", age: 8, language: "English" });
  const maya = await Child.create({ parentId: parent._id, name: "Maya", age: 14, language: "English" });

  const stories = [
    await Story.create({ ...DEMO_ANSWERS, childId: alex._id, mode: alex.mode, authorName: "Alex Morgan" }),
    await Story.create({ ...DEMO_ANSWERS, childId: maya._id, mode: maya.mode, authorName: "Maya Morgan" }),
  ];

  return {
    parentId: String(parent._id),
    childIds: { alex: String(alex._id), maya: String(maya._id) },
    storyIds: stories.map((s) => String(s._id)),
  };
}

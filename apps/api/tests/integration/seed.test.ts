// Guide BE-02: "A seed script creates the same test data as the Sprint 1 fixtures."
import argon2 from "argon2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { Child, Consent, Story, User } from "../../src/db/models/index.js";
import { SEED_PARENT, seedDatabase } from "../../src/db/seed.js";

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await seedDatabase();
});

afterAll(async () => {
  await disconnectFromDatabase();
});

describe("seed", () => {
  it("creates the fixture parent, verified, with a consent record", async () => {
    const parent = await User.findOne({ email: "parent@example.com" }).select("+passwordHash");
    expect(parent?.name).toBe("Sarah Jenkins");
    expect(parent?.role).toBe("parent");
    expect(parent?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(await argon2.verify(parent!.passwordHash, SEED_PARENT.password)).toBe(true);
    expect(await Consent.countDocuments({ parentId: parent!._id })).toBe(1);
  });

  it("creates Alex (8, Explorer) and Maya (14, Creator)", async () => {
    const children = await Child.find().sort({ age: 1 }).lean();
    expect(children.map((c) => [c.name, c.age, c.mode, c.language])).toEqual([
      ["Alex", 8, "junior", "English"],
      ["Maya", 14, "senior", "English"],
    ]);
  });

  it("creates one demo story per child with the DEMO_STORY answers", async () => {
    const stories = await Story.find().sort({ authorName: 1 }).lean();
    expect(stories.map((s) => s.authorName)).toEqual(["Alex Morgan", "Maya Morgan"]);
    for (const s of stories) {
      expect(s).toMatchObject({ status: "draft", storyPath: "three_act", heroType: "knight", charName: "Pip", heroPronoun: "he" });
      expect(s.heroWords3).toBe("I can keep going one step at a time.");
    }
  });

  it("gives the same result when run again (no duplicates)", async () => {
    await seedDatabase();
    expect(await User.countDocuments()).toBe(1);
    expect(await Child.countDocuments()).toBe(2);
    expect(await Story.countDocuments()).toBe(2);
    expect(await Consent.countDocuments()).toBe(1);
  });
});

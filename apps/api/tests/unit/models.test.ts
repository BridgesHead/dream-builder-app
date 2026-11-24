// Guide BE-02: "Each schema rejects missing required fields and unknown values;
// heroPronoun accepts only he or she."
// doc.validate() checks a document against its schema WITHOUT a database, so these are unit tests.
import { Error as MongooseError, Types } from "mongoose";
import { describe, expect, it } from "vitest";
import { AuditLog, Child, Comment, Consent, Job, Story, User } from "../../src/db/models/index.js";

const id = () => new Types.ObjectId();

// Validates a document and returns the names of the fields that failed ([] = valid).
async function invalidFields(doc: { validate: () => Promise<void> }): Promise<string[]> {
  try {
    await doc.validate();
    return [];
  } catch (err) {
    if (err instanceof MongooseError.ValidationError) return Object.keys(err.errors);
    throw err;
  }
}

const goodUser = { email: "Ali@Example.com", name: "Ali", passwordHash: "hash" };
const goodChild = { parentId: id(), name: "Alex", age: 8, language: "English" };
const goodStory = { childId: id(), mode: "junior" };

describe("every schema refuses missing required fields", () => {
  it.each([
    ["users", () => new User({}), ["email", "name", "passwordHash"]],
    ["consents", () => new Consent({}), ["parentId", "textVersion", "method", "ipAddress"]],
    ["children", () => new Child({}), ["parentId", "name", "age", "language", "mode"]],
    ["stories", () => new Story({}), ["childId", "mode"]],
    ["comments", () => new Comment({}), ["storyId", "authorId", "text"]],
    ["jobs", () => new Job({}), ["storyId", "type"]],
    ["auditLogs", () => new AuditLog({}), ["actorRole", "action", "targetType"]],
  ] as const)("%s", async (_name, make, required) => {
    const failed = await invalidFields(make());
    for (const field of required) expect(failed).toContain(field);
  });
});

describe("every schema refuses unknown values", () => {
  it.each([
    ["users.role", () => new User({ ...goodUser, role: "superhero" }), "role"],
    ["consents.method", () => new Consent({ parentId: id(), textVersion: "v1", ipAddress: "1.2.3.4", method: "pinky_promise" }), "method"],
    ["children.mode", () => new Child({ ...goodChild, mode: "expert" }), "mode"],
    ["stories.status", () => new Story({ ...goodStory, status: "final" }), "status"],
    ["stories.storyPath", () => new Story({ ...goodStory, storyPath: "four_act" }), "storyPath"],
    ["stories.heroType", () => new Story({ ...goodStory, heroType: "dragon" }), "heroType"],
    ["comments.type", () => new Comment({ storyId: id(), authorId: id(), text: "Nice", type: "shout" }), "type"],
    ["jobs.type", () => new Job({ storyId: id(), type: "make_coffee" }), "type"],
    ["jobs.status", () => new Job({ storyId: id(), type: "title", status: "done" }), "status"],
    ["auditLogs.actorRole", () => new AuditLog({ actorRole: "pirate", action: "x", targetType: "story" }), "actorRole"],
  ] as const)("%s", async (_name, make, field) => {
    expect(await invalidFields(make())).toContain(field);
  });

  it("refuses unknown fields (a field the schema doesn't have)", () => {
    expect(() => new Child({ ...goodChild, favouriteColour: "red" })).toThrow(MongooseError.StrictModeError);
    expect(() => new Story({ ...goodStory, secretField: 1 })).toThrow(MongooseError.StrictModeError);
  });
});

describe("heroPronoun", () => {
  it.each(["he", "she", null])("accepts %s", async (heroPronoun) => {
    expect(await invalidFields(new Story({ ...goodStory, heroPronoun }))).toEqual([]);
  });

  it.each(["they", "it", "He"])("refuses %s", async (heroPronoun) => {
    expect(await invalidFields(new Story({ ...goodStory, heroPronoun }))).toContain("heroPronoun");
  });
});

describe("children", () => {
  it.each([7, 15, 9.5])("refuses age %s (must be a whole number 8–14)", async (age) => {
    expect(await invalidFields(new Child({ ...goodChild, age }))).toContain("age");
  });

  it("defaults mode from age: under 12 is junior, 12 and over is senior", () => {
    expect(new Child({ ...goodChild, age: 11 }).mode).toBe("junior");
    expect(new Child({ ...goodChild, age: 12 }).mode).toBe("senior");
  });

  it("stores the parent's choice of mode instead of the default", () => {
    expect(new Child({ ...goodChild, age: 9, mode: "senior" }).mode).toBe("senior");
  });
});

describe("users", () => {
  it("saves the email lowercase", () => {
    expect(new User(goodUser).email).toBe("ali@example.com");
  });

  it("never puts passwordHash in JSON", () => {
    const json = new User(goodUser).toJSON() as Record<string, unknown>;
    expect(json).not.toHaveProperty("passwordHash");
    expect(json).toHaveProperty("id");
    expect(json).not.toHaveProperty("_id");
  });
});

describe("story panels and comic cells", () => {
  it("refuses a panel number outside 1–15", async () => {
    const story = new Story({ ...goodStory, panels: [{ number: 16 }] });
    expect((await invalidFields(story)).some((f) => f.startsWith("panels"))).toBe(true);
  });

  it("refuses the same panel number twice", async () => {
    const story = new Story({ ...goodStory, panels: [{ number: 1 }, { number: 1 }] });
    expect(await invalidFields(story)).toContain("panels");
  });

  it("refuses a picture stored as a web link (images must live in our bucket)", async () => {
    const story = new Story({ ...goodStory, panels: [{ number: 1, imageKey: "https://fal.media/files/x.png" }] });
    expect(await invalidFields(story)).toContain("panels.0.imageKey");
  });

  it("refuses an unknown comic bubble type", async () => {
    const story = new Story({ ...goodStory, comicCells: [{ page: 1, cell: 1, bubbleType: "shout" }] });
    expect(await invalidFields(story)).toContain("comicCells.0.bubbleType");
  });

  it("accepts a valid panel", async () => {
    const story = new Story({ ...goodStory, panels: [{ number: 3, text: "Pip took a deep breath.", imageKey: "stories/abc/panel-03.webp" }] });
    expect(await invalidFields(story)).toEqual([]);
  });
});

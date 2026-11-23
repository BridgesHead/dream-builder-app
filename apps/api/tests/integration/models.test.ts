// Integration tests for the data model: things only a real MongoDB can prove
// (indexes exist, unique email, append-only collections).
import mongoose, { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";
import { ALL_MODELS, AuditLog, Consent, Job, Story, User } from "../../src/db/models/index.js";

beforeAll(async () => {
  await connectToDatabase(config.mongodbUri);
  await mongoose.connection.db!.dropDatabase();
  await Promise.all(ALL_MODELS.map((m) => m.syncIndexes()));
});

afterAll(async () => {
  await disconnectFromDatabase();
});

// The key of every index on a collection, e.g. [{ _id: 1 }, { status: 1 }].
async function indexKeys(model: mongoose.Model<never>): Promise<Record<string, number>[]> {
  const indexes = await model.collection.indexes();
  return indexes.map((i) => i.key as Record<string, number>);
}

describe("indexes for the queries the screens make", () => {
  it("stories by child", async () => {
    expect(await indexKeys(Story as never)).toContainEqual({ childId: 1, updatedAt: -1 });
  });

  it("stories by status", async () => {
    expect(await indexKeys(Story as never)).toContainEqual({ status: 1 });
  });

  it("jobs by story", async () => {
    expect(await indexKeys(Job as never)).toContainEqual({ storyId: 1, createdAt: 1 });
  });
});

describe("users", () => {
  it("refuses a second account with the same email, whatever the letter case", async () => {
    await User.create({ email: "same@example.com", name: "One", passwordHash: "h" });
    await expect(User.create({ email: "SAME@example.com", name: "Two", passwordHash: "h" })).rejects.toMatchObject({
      code: 11000, // MongoDB's "duplicate key" error
    });
  });

  it("leaves passwordHash out of queries unless asked for", async () => {
    const found = await User.findOne({ email: "same@example.com" }).lean();
    expect(found).not.toHaveProperty("passwordHash");
    const withHash = await User.findOne({ email: "same@example.com" }).select("+passwordHash").lean();
    expect(withHash).toHaveProperty("passwordHash", "h");
  });
});

// [name, create one record, a normal field to try changing, a new value for it]
describe.each([
  ["auditLogs", () => AuditLog.create({ actorRole: "system", action: "test.run", targetType: "test" }), "action", "test.changed"],
  [
    "consents",
    () => Consent.create({ parentId: new Types.ObjectId(), textVersion: "v1", method: "email_verification", ipAddress: "127.0.0.1" }),
    "textVersion",
    "v2",
  ],
] as const)("%s are append-only", (_name, create, field, newValue) => {
  it("can be added", async () => {
    const doc = await create();
    expect(doc._id).toBeDefined();
  });

  it("cannot be changed with updateOne / updateMany", async () => {
    const doc = await create();
    const model = doc.constructor as mongoose.Model<unknown>;
    await expect(model.updateOne({ _id: doc._id }, { $set: { [field]: newValue } })).rejects.toThrow(/append-only/);
    await expect(model.updateMany({}, { $set: { [field]: newValue } })).rejects.toThrow(/append-only/);
    await expect(model.findOneAndUpdate({ _id: doc._id }, { $set: { [field]: newValue } })).rejects.toThrow(/append-only/);
  });

  it("cannot be changed by editing and saving", async () => {
    const doc = await create();
    doc.set(field, newValue);
    await expect(doc.save()).rejects.toThrow(/append-only/);
    // ...and the stored record really is unchanged.
    const model = doc.constructor as mongoose.Model<unknown>;
    const stored = (await model.findById(doc._id).lean()) as Record<string, unknown>;
    expect(stored[field]).not.toBe(newValue);
  });

  it("cannot be deleted", async () => {
    const doc = await create();
    const model = doc.constructor as mongoose.Model<unknown>;
    await expect(model.deleteOne({ _id: doc._id })).rejects.toThrow(/append-only/);
    await expect(model.deleteMany({})).rejects.toThrow(/append-only/);
    await expect(model.findOneAndDelete({ _id: doc._id })).rejects.toThrow(/append-only/);
    await expect(doc.deleteOne()).rejects.toThrow(/append-only/);
  });
});

// INTEGRATION tests: the real app talking to a real (test) MongoDB.
// supertest sends HTTP requests to the app without opening a port, like a fake frontend.
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { config } from "../../src/config.js";
import { connectToDatabase, disconnectFromDatabase } from "../../src/db/connect.js";

const app = createApp();

describe("GET /api/v1/health", () => {
  beforeAll(async () => {
    await connectToDatabase(config.mongodbUri);
  });

  afterAll(async () => {
    await disconnectFromDatabase();
  });

  it("returns 200 with the build version and database status", async () => {
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok", version: config.version, database: "connected" });
  });

  it("returns 503 when the database is not connected", async () => {
    await disconnectFromDatabase();
    const res = await request(app).get("/api/v1/health");
    expect(res.status).toBe(503);
    expect(res.body).toMatchObject({ status: "error", database: "disconnected" });
    // Reconnect so afterAll and later tests have a database again.
    await connectToDatabase(config.mongodbUri);
  });
});

describe("the shared error shape", () => {
  it("answers an unknown URL with 404 NOT_FOUND", async () => {
    const res = await request(app).get("/api/v1/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
  });

  it("answers broken JSON with 400 INVALID_JSON", async () => {
    const res = await request(app).post("/api/v1/health").set("Content-Type", "application/json").send("{oops");
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_JSON");
  });
});

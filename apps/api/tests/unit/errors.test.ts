// UNIT tests: check one small piece of code on its own, with no server and no database.
import { describe, expect, it } from "vitest";
import { AppError, errorBody } from "../../src/lib/errors.js";

describe("errorBody (the shared error shape)", () => {
  it("builds { error: { code, message } }", () => {
    expect(errorBody("NOT_FOUND", "Child not found")).toEqual({
      error: { code: "NOT_FOUND", message: "Child not found" },
    });
  });

  it("adds fields only when there are some", () => {
    expect(errorBody("VALIDATION_FAILED", "Bad input", { age: ["Too small"] })).toEqual({
      error: { code: "VALIDATION_FAILED", message: "Bad input", fields: { age: ["Too small"] } },
    });
  });
});

describe("AppError", () => {
  it("keeps the status, code and message we give it", () => {
    const err = new AppError(404, "NOT_FOUND", "Child not found");
    expect(err.status).toBe(404);
    expect(err.code).toBe("NOT_FOUND");
    expect(err.message).toBe("Child not found");
    expect(err).toBeInstanceOf(Error);
  });
});

// UNIT test for the validate middleware: we call it directly with fake req/res/next,
// so no server or database is needed.
import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AppError } from "../../src/lib/errors.js";
import { validate } from "../../src/middleware/validate.js";

const childSchema = z.object({ name: z.string().trim().min(1), age: z.number().int().min(8).max(14) });

function run(body: unknown) {
  const req = { body } as Request;
  const next = vi.fn() as unknown as NextFunction & ReturnType<typeof vi.fn>;
  validate(childSchema)(req, {} as Response, next);
  return { req, next };
}

describe("validate middleware", () => {
  it("passes good input on, cleaned up by Zod", () => {
    const { req, next } = run({ name: "  Ali  ", age: 9 });
    expect(next).toHaveBeenCalledWith(); // next() with nothing = "carry on"
    expect(req.body).toEqual({ name: "Ali", age: 9 });
  });

  it("stops bad input with a 400 VALIDATION_FAILED error listing each field", () => {
    const { next } = run({ name: "Ali", age: 20 });
    const err = next.mock.calls[0][0] as AppError;
    expect(err).toBeInstanceOf(AppError);
    expect(err.status).toBe(400);
    expect(err.code).toBe("VALIDATION_FAILED");
    expect(err.fields?.age?.length).toBeGreaterThan(0);
  });
});

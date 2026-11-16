import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../lib/errors.js";

// validate(schema) returns a middleware that checks req.body against a Zod schema.
// Bad input  -> 400 VALIDATION_FAILED with what's wrong per field, and the route never runs.
// Good input -> req.body is replaced with Zod's cleaned-up copy (trimmed, lowercased,
//               unknown fields removed) and the request moves on with next().
export function validate(schema: z.ZodType): RequestHandler {
  return (req, _res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      const { formErrors, fieldErrors } = z.flattenError(result.error);
      // Problems with one field, e.g. { age: ["Too small: expected number to be >=8"] }.
      // Problems with the body as a whole (not an object, unknown key on a strict schema)
      // go under the special name "_body".
      const fields = { ...fieldErrors, ...(formErrors.length > 0 && { _body: formErrors }) };
      // Hand the error to the errorHandler, which sends the shared shape.
      next(new AppError(400, "VALIDATION_FAILED", "Some fields are missing or invalid", fields));
      return;
    }

    req.body = result.data;
    next();
  };
}

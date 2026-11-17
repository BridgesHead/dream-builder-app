import { Router } from "express";
import { z } from "zod";
import { allow } from "../middleware/access.js";
import { validate } from "../middleware/validate.js";
import * as children from "../services/children.js";
import { MODES } from "../types/story.js";

// Child profiles (guide BE-04). Only a parent whose email is verified and whose consent is
// recorded gets in. Everyone else, a kids' wristband included, is refused (403).

const name = z.string().trim().min(1).max(50);
// Whole years, 8 to 14 (the ages Dream Builder is made for).
const age = z.number().int().min(8).max(14);
// As the frontend shows it, e.g. "English".
const language = z.string().trim().min(1).max(50);
const mode = z.enum(MODES);

// .strict(): unknown fields (like a sneaky "parentId") are refused, not silently dropped.
const createSchema = z.object({ name, age, language, mode: mode.optional() }).strict();
const updateSchema = z
  .object({ name: name.optional(), age: age.optional(), language: language.optional(), mode: mode.optional() })
  .strict()
  .refine((body) => Object.keys(body).length > 0, { message: "Send at least one field to change" });

export function createChildrenRouter(): Router {
  const router = Router();
  const parentOnly = allow("verified_parent");

  // GET /api/v1/children: my children (removed ones are hidden).
  router.get("/", parentOnly, async (req, res) => {
    res.json({ children: await children.listChildren(req.user!.id) });
    return;
  });

  // POST /api/v1/children  { name, age, language, mode? }
  router.post("/", parentOnly, validate(createSchema), async (req, res) => {
    const child = await children.createChild(req.user!.id, req.body, req.ip);
    res.status(201).json({ child });
    return;
  });

  // GET /api/v1/children/:id
  router.get("/:id", parentOnly, async (req, res) => {
    res.json({ child: await children.getChild(req.user!.id, String(req.params.id)) });
    return;
  });

  // PATCH /api/v1/children/:id  { name?, age?, language?, mode? }
  router.patch("/:id", parentOnly, validate(updateSchema), async (req, res) => {
    const child = await children.updateChild(req.user!.id, String(req.params.id), req.body, req.ip);
    res.json({ child });
    return;
  });

  // DELETE /api/v1/children/:id: a logged soft delete.
  router.delete("/:id", parentOnly, async (req, res) => {
    await children.removeChild(req.user!.id, String(req.params.id), req.ip);
    res.status(204).end();
    return;
  });

  return router;
}

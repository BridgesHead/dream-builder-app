import { Router } from "express";
import { AppError } from "../lib/errors.js";
import { readSignedLocal } from "../lib/storage.js";
import { allow } from "../middleware/access.js";

// Pictures from the LOCAL storage folder (guide BE-10), for your PC only. Mounted at
// /api/v1/media. On AWS, pictures come straight from S3 through S3's own signed links, so
// this route answers 404 there.
//
// "public" because an <img> tag can't send a login token: the signed link IS the permission.
// Only our API makes these links (GET /stories/:id/panels/:n/image), each for one picture,
// and each stops working after IMAGE_URL_TTL_SECONDS.

export function createMediaRouter(storageKind: "s3" | "local"): Router {
  const router = Router();

  // GET /api/v1/media/stories/<id>/panel-03.png?expires=...&sig=...
  router.get("/*key", allow("public"), async (req, res) => {
    const key = ([] as string[]).concat(req.params.key as string | string[]).join("/");
    const { expires, sig } = req.query;
    const file =
      storageKind === "local" && typeof expires === "string" && typeof sig === "string"
        ? await readSignedLocal(key, expires, sig)
        : null;
    // Wrong, expired or missing all look the same: 404.
    if (!file) throw new AppError(404, "NOT_FOUND", "Picture not found");
    res.set({
      "Content-Type": file.contentType,
      "Cache-Control": "private, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    res.send(file.body);
    return;
  });

  return router;
}

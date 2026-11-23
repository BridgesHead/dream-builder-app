import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { createApp } from "../../src/app.js";
import { closeRedis } from "../../src/lib/redis.js";

// The OpenAPI contract (packages/api-contracts/openapi.yaml) must list exactly the routes the
// app really has (guide BE-13: "the OpenAPI file matches the deployed API"). This test walks
// Express's own list of routes and compares it with the contract, both ways.

const PREFIX = "/api/v1";
const METHODS = ["get", "post", "put", "patch", "delete"] as const;

interface Layer {
  rawPath?: unknown;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: Layer[] };
}

/** Express path → OpenAPI path: "/stories/:id" → "/stories/{id}", "/*key" → "/{key}". */
function toOpenApiPath(path: string): string {
  return path.replace(/[:*](\w+)/g, "{$1}");
}

function join(prefix: string, path: string): string {
  const joined = `${prefix}/${path}`.replace(/\/+/g, "/");
  return joined.length > 1 ? joined.replace(/\/$/, "") : joined;
}

/** Every "METHOD /path" the app answers, read from Express's router. */
function appRoutes(): string[] {
  const app = createApp() as unknown as { router: { stack: Layer[] } };
  const found: string[] = [];
  const walk = (stack: Layer[], prefix: string) => {
    for (const layer of stack) {
      const path = typeof layer.rawPath === "string" ? layer.rawPath : "";
      if (layer.route) {
        for (const method of METHODS) {
          if (layer.route.methods[method]) found.push(`${method.toUpperCase()} ${toOpenApiPath(join(prefix, layer.route.path))}`);
        }
      } else if (layer.handle?.stack) {
        walk(layer.handle.stack, join(prefix, path));
      }
    }
  };
  walk(app.router.stack, "");
  return found
    .filter((r) => r.split(" ")[1].startsWith(PREFIX))
    .map((r) => r.replace(` ${PREFIX}`, " "))
    .map((r) => r.replace(/ \/$/, " /"))
    .sort();
}

/** Every "METHOD /path" in openapi.yaml. */
function contractRoutes(): string[] {
  const require = createRequire(import.meta.url);
  const file = require.resolve("@dream-builder/api-contracts/openapi.yaml");
  const spec = parse(readFileSync(file, "utf8")) as { paths: Record<string, Record<string, unknown>> };
  const found: string[] = [];
  for (const [path, item] of Object.entries(spec.paths)) {
    for (const method of METHODS) if (item[method]) found.push(`${method.toUpperCase()} ${path}`);
  }
  return found.sort();
}

describe("OpenAPI contract", () => {
  afterAll(async () => {
    await closeRedis();
  });

  const inApp = appRoutes();
  const inContract = contractRoutes();

  it("finds the app's routes", () => {
    // A sanity check, so a broken walk can't pass by finding nothing.
    expect(inApp.length).toBeGreaterThan(40);
    expect(inApp).toContain("GET /health");
    expect(inApp).toContain("PATCH /stories/{id}");
  });

  it("lists every route the app has", () => {
    expect(inApp.filter((r) => !inContract.includes(r)), "add these routes to openapi.yaml").toEqual([]);
  });

  it("lists no route the app doesn't have", () => {
    expect(inContract.filter((r) => !inApp.includes(r)), "remove these routes from openapi.yaml (or build them)").toEqual([]);
  });
});

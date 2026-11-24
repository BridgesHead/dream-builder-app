// Friendly names for the types generated from openapi.yaml (src/generated/openapi.ts).
//
//   import type { Child, Order, ApiPaths } from "@dream-builder/api-types";
//
// The generated file is rebuilt by `pnpm contracts` (and by every build/typecheck through
// Turborepo), so it always matches the contract. Never edit it by hand.
import type { components, paths, operations } from "./generated/openapi.js";

export type { components, paths as ApiPaths, operations as ApiOperations };

type Schemas = components["schemas"];

export type ApiError = Schemas["Error"];
export type Health = Schemas["Health"];
export type User = Schemas["User"];
export type UserRole = Schemas["UserRole"];
export type ParentSession = Schemas["ParentSession"];
export type ChildSession = Schemas["ChildSession"];
export type Mode = Schemas["Mode"];
export type Child = Schemas["Child"];
export type NewChild = Schemas["NewChild"];
export type DeletionPreview = Schemas["DeletionPreview"];
export type DeletionRequest = Schemas["DeletionRequest"];
export type StoryStatus = Schemas["StoryStatus"];
export type StoryPath = Schemas["StoryPath"];
export type StorySummary = Schemas["StorySummary"];
export type Story = Schemas["Story"];
export type StoryPatch = Schemas["StoryPatch"];
export type StoryProgress = Schemas["StoryProgress"];
export type Comment = Schemas["Comment"];
export type OrderTier = Schemas["OrderTier"];
export type Emirate = Schemas["Emirate"];
export type DeliveryAddress = Schemas["DeliveryAddress"];
export type Order = Schemas["Order"];
export type Prices = Schemas["Prices"];
export type AuditEntry = Schemas["AuditEntry"];
export type AdminProgress = Schemas["AdminProgress"];

/** The JSON body a route answers with, for one status code. */
export type ResponseOf<
  Op extends keyof operations,
  Code extends keyof operations[Op]["responses"] = 200 extends keyof operations[Op]["responses"] ? 200 : never,
> = operations[Op]["responses"][Code] extends { content: { "application/json": infer Body } } ? Body : never;

/** The JSON body a route takes. */
export type RequestOf<Op extends keyof operations> = operations[Op] extends {
  requestBody?: { content: { "application/json": infer Body } };
}
  ? Body
  : never;

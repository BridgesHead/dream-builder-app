import { model, Schema, type InferSchemaType } from "mongoose";
import { appendOnlySchemaOptions } from "../schemaOptions.js";

// "This facilitator (e.g. a teacher) may READ this child's stories" (guide BE-05).
// In this sprint, links are made only by the admin script (scripts/users.ts), never by the API.
const facilitatorLinkSchema = new Schema(
  {
    facilitatorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    // index: "which facilitators can see this child?"
    childId: { type: Schema.Types.ObjectId, ref: "Child", required: true, index: true },
  },
  // createdAt only: a link is made or removed, never edited.
  appendOnlySchemaOptions,
);

// One link per facilitator + child pair. Also serves "which children can this facilitator see?".
facilitatorLinkSchema.index({ facilitatorId: 1, childId: 1 }, { unique: true });

export type FacilitatorLinkFields = InferSchemaType<typeof facilitatorLinkSchema>;
export const FacilitatorLink = model("FacilitatorLink", facilitatorLinkSchema);

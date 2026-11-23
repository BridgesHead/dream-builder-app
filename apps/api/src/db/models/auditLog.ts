import { model, Schema, type InferSchemaType } from "mongoose";
import { appendOnlySchemaOptions, makeAppendOnly } from "../schemaOptions.js";

// Who can do things. "child_session" is a child using the parent's device (BE-04),
// "system" is the server itself (e.g. a script or a worker).
export const ACTOR_ROLES = ["parent", "child_session", "facilitator", "admin", "system"] as const;

// The security diary (guide BE-05): sign-ins, consent, child profile changes, story views
// by facilitators and admins, role changes and story approvals.
// Each entry: who, what, which record, when and from where. NEVER story text or secrets.
const auditLogSchema = new Schema(
  {
    // Who. null when the actor is the system.
    actorId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    actorRole: { type: String, enum: ACTOR_ROLES, required: true },
    // What, e.g. "auth.sign_in", "child.update", "story.approve".
    action: { type: String, required: true, trim: true, maxlength: 100 },
    // Which record, e.g. targetType "story" and its id.
    targetType: { type: String, required: true, trim: true, maxlength: 50 },
    targetId: { type: String, default: null, maxlength: 100 },
    // From where.
    ipAddress: { type: String, maxlength: 45, default: null },
    // When: the createdAt timestamp.
  },
  appendOnlySchemaOptions,
);

// "Who did what to this record?" and "what did this person do?"
auditLogSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
auditLogSchema.index({ actorId: 1, createdAt: -1 });

// Entries can be added, never changed or deleted (BE-05).
makeAppendOnly(auditLogSchema, "AuditLog");

export type AuditLogFields = InferSchemaType<typeof auditLogSchema>;
export const AuditLog = model("AuditLog", auditLogSchema);

import type { Schema } from "mongoose";

// Settings every top-level schema shares.
export const baseSchemaOptions = {
  // Mongoose adds and updates createdAt / updatedAt for us.
  timestamps: true,
  // An unknown field (a typo like "agee", or something we never planned to store) is an
  // ERROR, instead of being silently dropped. Mistakes show up straight away.
  strict: "throw",
  // How a document turns into JSON for API responses:
  toJSON: {
    // No "__v" (Mongoose's internal version counter).
    versionKey: false,
    transform(_doc: unknown, ret: Record<string, unknown>) {
      // Send "id" as plain text instead of Mongo's "_id" object; the frontend uses "id".
      ret.id = String(ret._id);
      delete ret._id;
      // Belt and braces: a password hash must never leave the server, even by mistake.
      delete ret.passwordHash;
      return ret;
    },
  },
} as const;

// Settings for records that are only ever ADDED, never changed (audit log, consents).
// There is no updatedAt, because nothing is ever updated.
export const appendOnlySchemaOptions = {
  ...baseSchemaOptions,
  timestamps: { createdAt: true, updatedAt: false },
} as const;

// Settings for small objects stored INSIDE a document (panels inside a story).
// They have no id of their own; the panel number identifies them.
export const subdocumentOptions = { _id: false, strict: "throw" } as const;

const UPDATE_AND_DELETE_QUERIES = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
  "findOneAndReplace",
  "replaceOne",
  "deleteOne",
  "deleteMany",
  "findOneAndDelete",
] as const;

// Makes a collection append-only through Mongoose: records can be created, but every
// attempt to change or delete one throws. Used for auditLogs (BE-05: "No API route can
// change or delete an audit entry") and consents (BE-03: "never overwrite the old one").
export function makeAppendOnly(schema: Schema, name: string): void {
  const refuse = () => {
    throw new Error(`${name} records are append-only: they cannot be changed or deleted`);
  };

  // Query style: Model.updateOne(...), Model.deleteMany(...), ...
  schema.pre([...UPDATE_AND_DELETE_QUERIES], { document: false, query: true }, refuse);

  // Document style: doc.deleteOne()
  schema.pre("deleteOne", { document: true, query: false }, refuse);

  // Document style: change a loaded record, then doc.save()
  schema.pre("save", function () {
    if (!this.isNew) refuse();
  });
}

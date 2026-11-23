import type { Types } from "mongoose";
import type { UserRole } from "../db/models/index.js";

// The ONLY shape of a user that leaves the server. Built field by field, so a new private
// field added to the users schema later can never leak by accident.
export interface PublicUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  emailVerified: boolean;
}

interface UserLike {
  _id: Types.ObjectId;
  name: string;
  email: string;
  role: UserRole;
  emailVerifiedAt?: Date | null;
}

export function toPublicUser(user: UserLike): PublicUser {
  return {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
    emailVerified: user.emailVerifiedAt != null,
  };
}

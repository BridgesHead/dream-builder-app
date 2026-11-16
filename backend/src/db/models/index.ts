// One place to import every model from:
//   import { Story, Child } from "../db/models/index.js";
export { User, USER_ROLES, type UserRole } from "./user.js";
export { Consent, CONSENT_METHODS } from "./consent.js";
export { Child } from "./child.js";
export { Story } from "./story.js";
export { Comment, COMMENT_TYPES } from "./comment.js";
export { Job, JOB_TYPES, type JobType } from "./job.js";
export { AuditLog, ACTOR_ROLES } from "./auditLog.js";

import { AuditLog } from "./auditLog.js";
import { Child } from "./child.js";
import { Comment } from "./comment.js";
import { Consent } from "./consent.js";
import { Job } from "./job.js";
import { Story } from "./story.js";
import { User } from "./user.js";

// All seven collections from guide BE-02, e.g. for building every index at once.
export const ALL_MODELS = [User, Consent, Child, Story, Comment, Job, AuditLog];

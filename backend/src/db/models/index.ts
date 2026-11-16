// One place to import every model from:
//   import { Story, Child } from "../db/models/index.js";
export { User, USER_ROLES, type UserRole } from "./user.js";
export { Consent, CONSENT_METHODS } from "./consent.js";
export { Child } from "./child.js";
export { Story } from "./story.js";
export { Comment, COMMENT_TYPES } from "./comment.js";
export { Job, JOB_TYPES, type JobType } from "./job.js";
export { AuditLog, ACTOR_ROLES } from "./auditLog.js";
export { Session } from "./session.js";
export { EmailLink, EMAIL_LINK_PURPOSES, type EmailLinkPurpose } from "./emailLink.js";

import { AuditLog } from "./auditLog.js";
import { Child } from "./child.js";
import { Comment } from "./comment.js";
import { Consent } from "./consent.js";
import { EmailLink } from "./emailLink.js";
import { Job } from "./job.js";
import { Session } from "./session.js";
import { Story } from "./story.js";
import { User } from "./user.js";

// Every collection: the seven from guide BE-02, plus sessions and emailLinks (BE-03).
// Used e.g. for building every index at once.
export const ALL_MODELS = [User, Consent, Child, Story, Comment, Job, AuditLog, Session, EmailLink];

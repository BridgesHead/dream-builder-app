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
export { FacilitatorLink } from "./facilitatorLink.js";
export { Order, ORDER_TIERS, PAYMENT_STATUSES, PRINT_STATUSES, EMIRATES, type OrderTier, type PaymentStatus, type PrintStatus } from "./order.js";
export { StripeEvent } from "./stripeEvent.js";
export { DeletionRequest, DELETION_STATUSES, type DeletionStatus } from "./deletionRequest.js";

import { AuditLog } from "./auditLog.js";
import { Child } from "./child.js";
import { Comment } from "./comment.js";
import { Consent } from "./consent.js";
import { DeletionRequest } from "./deletionRequest.js";
import { EmailLink } from "./emailLink.js";
import { FacilitatorLink } from "./facilitatorLink.js";
import { Job } from "./job.js";
import { Order } from "./order.js";
import { Session } from "./session.js";
import { Story } from "./story.js";
import { StripeEvent } from "./stripeEvent.js";
import { User } from "./user.js";

// Every collection: the seven from guide BE-02, plus sessions and emailLinks (BE-03)
// and facilitatorLinks (BE-05), orders + stripeEvents (BE-17), and deletionRequests (BE-16).
// Used e.g. for building every index at once.
export const ALL_MODELS = [User, Consent, Child, Story, Comment, Job, AuditLog, Session, EmailLink, FacilitatorLink, Order, StripeEvent, DeletionRequest];

// The ONE error shape every API error uses:
//
//   { "error": { "code": "NOT_FOUND", "message": "Not found" } }
//
// and for bad input, also the problem per field:
//
//   { "error": { "code": "VALIDATION_FAILED", "message": "...", "fields": { "age": ["..."] } } }
//
// `code` is for the frontend's code (it never changes, so it's safe to check in an if).
// `message` is for humans (we may reword it any time).

// Every code the API can send. Later stories add theirs here.
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_JSON"
  | "BODY_TOO_LARGE"
  | "UNAUTHENTICATED" // no token, or a token we don't recognise
  | "SESSION_EXPIRED" // the token was real but is too old: refresh or log in again
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATUS_CHANGE"
  // BE-03 accounts
  | "INVALID_CREDENTIALS" // wrong password or unknown email (same answer for both)
  | "EMAIL_TAKEN"
  | "WEAK_PASSWORD"
  | "CONSENT_REQUIRED"
  | "EMAIL_NOT_VERIFIED"
  | "LINK_INVALID" // a verify/reset link we never made
  | "LINK_USED" // a verify/reset link that already worked once
  | "LINK_EXPIRED" // a verify/reset link older than 24 hours
  | "TOO_MANY_ATTEMPTS"
  // BE-08 story drafts
  | "STORY_NOT_DRAFT" // the story has left draft, so the wizard can't change it
  | "STORY_INCOMPLETE" // generation asked for before every step is done; fields.missingSteps lists them
  | "GENERATION_NOT_READY" // the job queue couldn't take the story (e.g. Redis is down); try again
  | "INTERNAL_ERROR";

export type FieldErrors = Record<string, string[] | undefined>;

export interface ErrorBody {
  error: { code: ErrorCode; message: string; fields?: FieldErrors };
}

// An error WE create on purpose, because we know what went wrong.
// Throw it anywhere (route, service, middleware) and the errorHandler turns it into
// the shared shape with the right status:
//
//   throw new AppError(404, "NOT_FOUND", "Child not found");
export class AppError extends Error {
  readonly status: number;
  readonly code: ErrorCode;
  readonly fields?: FieldErrors;

  constructor(status: number, code: ErrorCode, message: string, fields?: FieldErrors) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
    this.fields = fields;
  }
}

// Builds the JSON body for an error, so every place sends exactly the same shape.
export function errorBody(code: ErrorCode, message: string, fields?: FieldErrors): ErrorBody {
  return { error: { code, message, ...(fields && { fields }) } };
}

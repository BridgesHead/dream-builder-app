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

// Every code the API can send. Later stories add theirs here
// (e.g. BE-03 adds EMAIL_TAKEN, WRONG_PASSWORD, WEAK_PASSWORD, SESSION_EXPIRED).
export type ErrorCode =
  | "VALIDATION_FAILED"
  | "INVALID_JSON"
  | "BODY_TOO_LARGE"
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATUS_CHANGE"
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

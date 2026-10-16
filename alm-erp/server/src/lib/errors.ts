export class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'BAD_REQUEST', message, details);
export const unauthorized = (message = 'Authentication required.') => new HttpError(401, 'UNAUTHENTICATED', message);
export const forbidden = (message = 'You do not have permission to perform this action.') =>
  new HttpError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Record') => new HttpError(404, 'NOT_FOUND', `${what} not found.`);
export const conflict = (message: string, details?: unknown) => new HttpError(409, 'CONFLICT', message, details);
/** A business rule rejected the operation (valid request, invalid in the current state). */
export const ruleViolation = (message: string, details?: unknown) =>
  new HttpError(422, 'BUSINESS_RULE', message, details);

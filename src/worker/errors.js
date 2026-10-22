export class ApiError extends Error {
  constructor(code, status, message, retryAfter) {
    super(message);
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}
export const invalid = () =>
  new ApiError('INVALID_INPUT', 400, 'Check the location and date inputs.');
export const malformed = () =>
  new ApiError(
    'UPSTREAM_INVALID',
    502,
    'The weather service returned unusable data. Please retry.',
  );

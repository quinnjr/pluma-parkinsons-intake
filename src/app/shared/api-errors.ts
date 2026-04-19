export interface ValidationError {
  field: string;
  reason: string;
}

export interface ApiErrorBody {
  ok: false;
  errors: ValidationError[];
}

// Pull the first error reason out of an HttpClient error, with a fallback.
// Every server error response is `{ ok: false, errors: [...] }`.
export function firstErrorReason(err: unknown, fallback: string): string {
  const body = (err as { error?: unknown }).error;
  if (
    body != null &&
    typeof body === 'object' &&
    'errors' in body &&
    Array.isArray((body as { errors: unknown }).errors)
  ) {
    const first = (body as ApiErrorBody).errors[0];
    if (first) return first.reason;
  }
  return fallback;
}

export function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number }).status;
}

import type { ValidationError } from './anonymize.js';

export function errBody(field: string, reason: string): { ok: false; errors: ValidationError[] } {
  return { ok: false, errors: [{ field, reason }] };
}

export function issuesToErrors(
  issues: readonly { path: readonly PropertyKey[]; message: string }[],
): ValidationError[] {
  return issues.map((i) => ({
    field: i.path.length > 0 ? i.path.map(String).join('.') : 'body',
    reason: i.message,
  }));
}

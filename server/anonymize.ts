// Full ZIP is accepted because it's encrypted at rest before storage;
// direct-PII keys (name, email) are rejected outright.

import { z } from 'zod';

export const EMAIL_RE = /\S+@\S+\.\S+/;
export const ZIP_RE = /^\d{5}(-\d{4})?$/;

export const FORBIDDEN_PII_KEYS = ['firstName', 'lastName', 'email', 'patient'] as const;

export const nullable = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((v) => (v === '' || v == null ? null : v), z.union([z.null(), schema]));

export interface ValidationError {
  field: string;
  reason: string;
}

export function checkPiiKeys(body: unknown): ValidationError[] {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return [];
  const out: ValidationError[] = [];
  for (const key of FORBIDDEN_PII_KEYS) {
    if (key in (body as Record<string, unknown>)) {
      out.push({ field: key, reason: 'direct PII is not accepted' });
    }
  }
  return out;
}

const submissionSchema = z.object({
  schemaVersion: z.string().min(1, 'missing'),
  generatedAt: z.string().min(1, 'missing'),
  zipCode: nullable(z.string().regex(ZIP_RE, 'must be 5 digits or 5+4 format')),
  ageBand: nullable(z.string()),
  sexAtBirth: nullable(z.string()),
  markdown: z
    .string()
    .min(1, 'missing')
    .refine((v) => !EMAIL_RE.test(v), { message: 'contains an email address' }),
  sections: z.array(z.unknown()),
});

export type IncomingPayload = z.output<typeof submissionSchema>;

export type ValidationResult =
  | { ok: true; sanitized: IncomingPayload }
  | { ok: false; errors: ValidationError[] };

export function validateAndSanitize(input: unknown): ValidationResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, errors: [{ field: 'body', reason: 'Expected a JSON object.' }] };
  }

  const errors: ValidationError[] = checkPiiKeys(input);

  const parsed = submissionSchema.safeParse(input);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({
        field: issue.path.length > 0 ? issue.path.map(String).join('.') : 'body',
        reason: issue.message,
      });
    }
    return { ok: false, errors };
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, sanitized: parsed.data };
}

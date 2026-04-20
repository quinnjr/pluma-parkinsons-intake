import { describe, expect, it } from 'vitest';
import {
  EMAIL_RE,
  FORBIDDEN_PII_KEYS,
  ZIP_RE,
  checkPiiKeys,
  validateAndSanitize,
} from './anonymize.js';

const validBody = {
  schemaVersion: '1.1.0',
  generatedAt: new Date().toISOString(),
  zipCode: '33130',
  ageBand: '60-69',
  sexAtBirth: 'male',
  markdown: '# Some content with no mail address.',
  sections: [],
};

describe('regex guards', () => {
  it('EMAIL_RE matches a basic email', () => {
    expect(EMAIL_RE.test('alice@example.com')).toBe(true);
    expect(EMAIL_RE.test('no email here')).toBe(false);
  });

  it('ZIP_RE matches 5-digit and ZIP+4', () => {
    expect(ZIP_RE.test('33130')).toBe(true);
    expect(ZIP_RE.test('33130-1234')).toBe(true);
    expect(ZIP_RE.test('3313')).toBe(false);
    expect(ZIP_RE.test('33130-12')).toBe(false);
  });
});

describe('checkPiiKeys', () => {
  it('returns [] for non-objects', () => {
    expect(checkPiiKeys(null)).toEqual([]);
    expect(checkPiiKeys('x')).toEqual([]);
    expect(checkPiiKeys([])).toEqual([]);
  });

  it('flags each forbidden key present', () => {
    const errs = checkPiiKeys({ firstName: 'a', lastName: 'b', markdown: 'ok' });
    expect(errs).toHaveLength(2);
    expect(errs.map((e) => e.field).sort()).toEqual(['firstName', 'lastName']);
  });

  it('flags every forbidden key in FORBIDDEN_PII_KEYS', () => {
    const withAll = Object.fromEntries(FORBIDDEN_PII_KEYS.map((k) => [k, 'x']));
    expect(checkPiiKeys(withAll)).toHaveLength(FORBIDDEN_PII_KEYS.length);
  });

  it('returns [] when no forbidden keys are present', () => {
    expect(checkPiiKeys({ markdown: 'ok' })).toEqual([]);
  });
});

describe('validateAndSanitize', () => {
  it('accepts a well-formed submission and fills livedInStates default', () => {
    const r = validateAndSanitize(validBody);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sanitized.zipCode).toBe('33130');
      expect(r.sanitized.livedInStates).toEqual([]);
    }
  });

  it('rejects non-object input with a body-level error', () => {
    const r = validateAndSanitize('nope');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toEqual({ field: 'body', reason: 'Expected a JSON object.' });
  });

  it('rejects arrays (Zod treats them as objects otherwise)', () => {
    const r = validateAndSanitize([]);
    expect(r.ok).toBe(false);
  });

  it('surfaces direct-PII violations alongside valid body', () => {
    const r = validateAndSanitize({ ...validBody, email: 'x@y.z' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'email')).toBe(true);
  });

  it("rejects markdown that leaks an email address", () => {
    const r = validateAndSanitize({ ...validBody, markdown: 'see alice@example.com' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.reason.match(/email/i))).toBe(true);
  });

  it('rejects a malformed ZIP code', () => {
    const r = validateAndSanitize({ ...validBody, zipCode: '333-abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.field === 'zipCode')).toBe(true);
  });

  it('accepts null or empty string for nullable ZIP', () => {
    expect(validateAndSanitize({ ...validBody, zipCode: null }).ok).toBe(true);
    expect(validateAndSanitize({ ...validBody, zipCode: '' }).ok).toBe(true);
  });

  it('accepts and preserves a well-formed livedInStates entry', () => {
    const uuid = '12345678-1234-4234-8234-123456789abc';
    const r = validateAndSanitize({
      ...validBody,
      livedInStates: [{ state: 'FL', livedYears: 12, nearSiteIds: [uuid] }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.sanitized.livedInStates).toHaveLength(1);
      expect(r.sanitized.livedInStates[0]!.state).toBe('FL');
    }
  });

  it('rejects lowercase state code in livedInStates', () => {
    const r = validateAndSanitize({
      ...validBody,
      livedInStates: [{ state: 'fl', livedYears: null, nearSiteIds: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects livedYears out of range', () => {
    const r = validateAndSanitize({
      ...validBody,
      livedInStates: [{ state: 'FL', livedYears: 200, nearSiteIds: [] }],
    });
    expect(r.ok).toBe(false);
  });

  it('rejects a non-UUID nearSiteId', () => {
    const r = validateAndSanitize({
      ...validBody,
      livedInStates: [{ state: 'FL', livedYears: null, nearSiteIds: ['not-a-uuid'] }],
    });
    expect(r.ok).toBe(false);
  });

  it('requires markdown', () => {
    const r = validateAndSanitize({ ...validBody, markdown: '' });
    expect(r.ok).toBe(false);
  });

  it('emits body-level error for missing top-level keys', () => {
    const r = validateAndSanitize({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThan(0);
  });
});

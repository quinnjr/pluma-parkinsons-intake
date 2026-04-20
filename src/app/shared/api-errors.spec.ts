import { describe, expect, it } from 'vitest';
import { errorStatus, firstErrorReason } from './api-errors';

describe('firstErrorReason', () => {
  it('returns the first error reason from a well-formed HttpClient error', () => {
    const err = { error: { ok: false, errors: [{ field: 'x', reason: 'no good' }] } };
    expect(firstErrorReason(err, 'fallback')).toBe('no good');
  });

  it('returns the fallback on a malformed body', () => {
    expect(firstErrorReason({}, 'fallback')).toBe('fallback');
    expect(firstErrorReason({ error: 'string body' }, 'fallback')).toBe('fallback');
    expect(firstErrorReason({ error: { errors: 'not-an-array' } }, 'fallback')).toBe('fallback');
  });

  it('returns the fallback when errors array is empty', () => {
    expect(firstErrorReason({ error: { ok: false, errors: [] } }, 'fallback')).toBe('fallback');
  });

});

describe('errorStatus', () => {
  it('returns the status from an HttpClient error', () => {
    expect(errorStatus({ status: 401 })).toBe(401);
  });

  it('returns undefined when status is missing', () => {
    expect(errorStatus({})).toBeUndefined();
    expect(errorStatus({ error: 'x' })).toBeUndefined();
  });
});

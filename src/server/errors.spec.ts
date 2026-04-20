import { describe, expect, it } from 'vitest';
import { errBody, issuesToErrors } from './errors.js';

describe('errBody', () => {
  it('wraps a single field/reason into the standard envelope', () => {
    expect(errBody('email', 'must be a valid email')).toEqual({
      ok: false,
      errors: [{ field: 'email', reason: 'must be a valid email' }],
    });
  });
});

describe('issuesToErrors', () => {
  it('joins nested Zod paths with dots', () => {
    const issues = [{ path: ['user', 'email'], message: 'required' }];
    expect(issuesToErrors(issues)).toEqual([{ field: 'user.email', reason: 'required' }]);
  });

  it("uses 'body' when the path is empty", () => {
    const issues = [{ path: [] as PropertyKey[], message: 'expected object' }];
    expect(issuesToErrors(issues)).toEqual([{ field: 'body', reason: 'expected object' }]);
  });

  it('stringifies numeric path segments (Zod array indices)', () => {
    const issues = [{ path: ['items', 0, 'name'], message: 'required' }];
    expect(issuesToErrors(issues)).toEqual([{ field: 'items.0.name', reason: 'required' }]);
  });

  it('handles multiple issues', () => {
    const issues = [
      { path: ['email'], message: 'invalid' },
      { path: ['password'], message: 'too short' },
    ];
    expect(issuesToErrors(issues)).toHaveLength(2);
  });
});

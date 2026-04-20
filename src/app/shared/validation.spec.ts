import { describe, expect, it } from 'vitest';
import { SIX_DIGIT_PATTERN } from './validation';

describe('SIX_DIGIT_PATTERN', () => {
  it('preserves the literal \\d (not d)', () => {
    expect(SIX_DIGIT_PATTERN).toBe('\\d{6}');
  });

  it('matches a 6-digit code when used as a RegExp', () => {
    const re = new RegExp(`^${SIX_DIGIT_PATTERN}$`);
    expect(re.test('123456')).toBe(true);
    expect(re.test('12345')).toBe(false);
    expect(re.test('1234567')).toBe(false);
    expect(re.test('12345a')).toBe(false);
  });
});

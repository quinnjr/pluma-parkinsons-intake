// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { signChallengeToken, verifyChallengeToken } from './challenge-token.js';

describe('challenge-token', () => {
  it('signs and round-trips a payload for the declared audience', async () => {
    const token = await signChallengeToken('aud-a', { userId: 'u1', challenge: 'abc' });
    const payload = await verifyChallengeToken('aud-a', token);
    expect(payload).not.toBeNull();
    expect(payload!['userId']).toBe('u1');
    expect(payload!['challenge']).toBe('abc');
  });

  it('rejects a token signed for a different audience', async () => {
    const token = await signChallengeToken('aud-a', { k: 'v' });
    expect(await verifyChallengeToken('aud-b', token)).toBeNull();
  });

  it('rejects a garbage token', async () => {
    expect(await verifyChallengeToken('aud-a', 'not-a-jwt')).toBeNull();
  });

  it('rejects an expired token', async () => {
    const token = await signChallengeToken('aud-a', { k: 'v' }, -10);
    expect(await verifyChallengeToken('aud-a', token)).toBeNull();
  });
});

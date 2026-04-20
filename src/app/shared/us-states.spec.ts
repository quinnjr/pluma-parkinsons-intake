import { describe, expect, it } from 'vitest';
import { US_STATE_NAMES } from './us-states';

describe('US_STATE_NAMES', () => {
  it('covers all 50 states + DC', () => {
    const expected = [
      'AL','AK','AZ','AR','CA','CO','CT','DE','FL','GA','HI','ID','IL','IN','IA','KS','KY',
      'LA','ME','MD','MA','MI','MN','MS','MO','MT','NE','NV','NH','NJ','NM','NY','NC','ND',
      'OH','OK','OR','PA','RI','SC','SD','TN','TX','UT','VT','VA','WA','WV','WI','WY','DC',
    ];
    for (const code of expected) {
      expect(US_STATE_NAMES[code]).toBeTruthy();
    }
  });

  it('covers the 5 U.S. territories', () => {
    for (const code of ['PR', 'GU', 'VI', 'AS', 'MP']) {
      expect(US_STATE_NAMES[code]).toBeTruthy();
    }
  });

  it('maps FL → Florida and TX → Texas', () => {
    expect(US_STATE_NAMES['FL']).toBe('Florida');
    expect(US_STATE_NAMES['TX']).toBe('Texas');
  });

  it('returns undefined for unknown codes', () => {
    expect(US_STATE_NAMES['ZZ']).toBeUndefined();
  });
});

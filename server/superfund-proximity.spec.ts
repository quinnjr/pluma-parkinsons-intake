import { describe, it, expect } from 'vitest';
import { haversineMiles, bboxBounds } from './superfund-proximity.js';

describe('haversineMiles', () => {
  it('returns ~0 for identical points', () => {
    const d = haversineMiles(40, -74, 40, -74);
    expect(d).toBeCloseTo(0, 3);
  });

  it('matches known NYC→LAX great-circle distance (~2451 mi)', () => {
    const d = haversineMiles(40.6413, -73.7781, 33.9416, -118.4085);
    expect(d).toBeGreaterThan(2440);
    expect(d).toBeLessThan(2475);
  });

  it('handles sub-mile distances', () => {
    // Two points ~0.1° apart in lat near 40N ≈ 6.9 mi
    const d = haversineMiles(40, -74, 40.1, -74);
    expect(d).toBeGreaterThan(6.8);
    expect(d).toBeLessThan(7);
  });
});

describe('bboxBounds', () => {
  it('widens longitude delta at high latitude', () => {
    const a = bboxBounds(0, 0, 10);
    const b = bboxBounds(60, 0, 10);
    expect(b.lngDelta).toBeGreaterThan(a.lngDelta);
  });

  it('encloses the radius in both axes', () => {
    const { latDelta, lngDelta } = bboxBounds(40, -74, 10);
    expect(latDelta).toBeGreaterThan(0.14);
    expect(latDelta).toBeLessThan(0.16);
    expect(lngDelta).toBeGreaterThan(0.18);
    expect(lngDelta).toBeLessThan(0.22);
  });
});

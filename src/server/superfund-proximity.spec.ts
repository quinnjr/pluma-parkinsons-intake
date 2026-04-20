// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bboxBounds, haversineMiles, nearbySites } from './superfund-proximity.js';
import { createTestDb, type TestDb } from './test-db.js';

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
    const d = haversineMiles(40, -74, 40.1, -74);
    expect(d).toBeGreaterThan(6.8);
    expect(d).toBeLessThan(7);
  });
});

describe('bboxBounds', () => {
  it('widens longitude delta at high latitude', () => {
    const a = bboxBounds(0, 10);
    const b = bboxBounds(60, 10);
    expect(b.lngDelta).toBeGreaterThan(a.lngDelta);
  });

  it('encloses the radius in both axes', () => {
    const { latDelta, lngDelta } = bboxBounds(40, 10);
    expect(latDelta).toBeGreaterThan(0.14);
    expect(latDelta).toBeLessThan(0.16);
    expect(lngDelta).toBeGreaterThan(0.18);
    expect(lngDelta).toBeLessThan(0.22);
  });
});

describe('nearbySites (Prisma-backed)', () => {
  let db: TestDb;

  beforeAll(async () => {
    db = await createTestDb();
    await db.prisma.zipCentroid.create({
      data: { zipCode: '33130', latitude: 25.7617, longitude: -80.1918, state: 'FL' },
    });
    await db.prisma.superfundSite.createMany({
      data: [
        {
          epaId: 'NEAR-1', name: 'Close Site', state: 'FL',
          latitude: 25.78, longitude: -80.20, status: 'final',
        },
        {
          epaId: 'NEAR-2', name: 'Medium Site', state: 'FL',
          latitude: 25.85, longitude: -80.25, status: 'final',
        },
        {
          epaId: 'FAR-1', name: 'Tallahassee', state: 'FL',
          latitude: 30.45, longitude: -84.28, status: 'final',
        },
      ],
    });
  });

  afterAll(() => db.dispose());

  it('returns { found: false, sites: [] } when ZIP centroid is unknown', async () => {
    const r = await nearbySites(db.prisma, '99999');
    expect(r).toEqual({ found: false, sites: [] });
  });

  it('returns only sites within the radius and sorts by distance', async () => {
    const r = await nearbySites(db.prisma, '33130');
    expect(r.found).toBe(true);
    expect(r.sites.map((s) => s.epaId)).toEqual(['NEAR-1', 'NEAR-2']);
    expect(r.sites[0]!.distanceMiles).toBeLessThan(r.sites[1]!.distanceMiles);
  });

  it('empties the result list when radius is small enough to exclude everything', async () => {
    const r = await nearbySites(db.prisma, '33130', 0.5);
    expect(r.found).toBe(true);
    expect(r.sites).toEqual([]);
  });

  it('includes the far site when radius is large', async () => {
    const r = await nearbySites(db.prisma, '33130', 600);
    expect(r.sites.map((s) => s.epaId)).toContain('FAR-1');
  });
});

// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  parseSuperfundCsv,
  parseZipCentroidCsv,
  seedSuperfundIfEmpty,
  upsertSuperfundSites,
  upsertZipCentroids,
  type SuperfundRow,
  type ZipCentroidRow,
} from './superfund-importer.js';
import { createTestDb, type TestDb } from './test-db.js';

describe('parseSuperfundCsv', () => {
  it('parses a minimal row', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'FLD980602767,Helena Chemical Co,Tampa,Hillsborough,FL,33605,27.9820,-82.4200,final,1983-09-08,,"arsenic, lead",https://cumulis.epa.gov/supercpad/CurSites/csitinfo.cfm?id=0401162',
    ].join('\n');
    const rows = parseSuperfundCsv(csv);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      epaId: 'FLD980602767',
      name: 'Helena Chemical Co',
      city: 'Tampa',
      county: 'Hillsborough',
      state: 'FL',
      zipCode: '33605',
      latitude: 27.982,
      longitude: -82.42,
      status: 'final',
      contaminants: 'arsenic, lead',
    });
    expect(rows[0].listedOn).toBeInstanceOf(Date);
    expect(rows[0].deletedOn).toBeNull();
  });

  it('handles quoted fields with embedded commas', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'XYZ,"Acme, Inc.",Reno,Washoe,NV,89501,39.5,-119.8,deleted,1990-01-01,2010-05-05,"PCE, TCE, vinyl chloride",',
    ].join('\n');
    const rows = parseSuperfundCsv(csv);
    expect(rows[0].name).toBe('Acme, Inc.');
    expect(rows[0].contaminants).toBe('PCE, TCE, vinyl chloride');
    expect(rows[0].deletedOn).toBeInstanceOf(Date);
  });

  it('normalizes status variants', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,A,,,FL,33130,25,-80,Proposed,,,,',
      'B,B,,,FL,33130,25,-80,Deleted from NPL,,,,',
      'C,C,,,FL,33130,25,-80,Partial Deletion,,,,',
      'D,D,,,FL,33130,25,-80,NPL,,,,',
    ].join('\n');
    const rows = parseSuperfundCsv(csv);
    expect(rows.map((r) => r.status)).toEqual([
      'proposed', 'deleted', 'partial-deletion', 'final',
    ]);
  });

  it('throws on unknown status', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,A,,,FL,33130,25,-80,gibberish,,,,',
    ].join('\n');
    expect(() => parseSuperfundCsv(csv)).toThrow(/unknown Superfund status/);
  });

  it('throws on unparseable latitude', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,B,C,D,FL,12345,not-a-number,-82,final,1983-09-08,,,',
    ].join('\n');
    expect(() => parseSuperfundCsv(csv)).toThrow(/latitude/i);
  });

  it('throws on unparseable date', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,B,C,D,FL,12345,25,-82,final,not-a-date,,,',
    ].join('\n');
    expect(() => parseSuperfundCsv(csv)).toThrow(/unparseable date/);
  });

  it('emits null for blank optional cells (city, county, zipCode, contaminants, epaUrl)', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,Name,,,FL,,25,-80,final,,,,',
    ].join('\n');
    const [row] = parseSuperfundCsv(csv);
    expect(row!.city).toBeNull();
    expect(row!.county).toBeNull();
    expect(row!.zipCode).toBeNull();
    expect(row!.contaminants).toBeNull();
    expect(row!.epaUrl).toBeNull();
  });

  it('uppercases the state code', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,Name,,,fl,,25,-80,final,,,,',
    ].join('\n');
    expect(parseSuperfundCsv(csv)[0]!.state).toBe('FL');
  });
});

describe('parseZipCentroidCsv', () => {
  it('parses a minimal row', () => {
    const csv = ['ZCTA5,LAT,LNG,STATE_USPS', '33130,25.7617,-80.1918,FL'].join('\n');
    const rows = parseZipCentroidCsv(csv);
    expect(rows).toEqual([
      { zipCode: '33130', latitude: 25.7617, longitude: -80.1918, state: 'FL' },
    ]);
  });

  it('pads 4-digit ZIPs to 5 digits', () => {
    const csv = ['ZCTA5,LAT,LNG,STATE_USPS', '5001,44.0,-72.0,VT'].join('\n');
    const rows = parseZipCentroidCsv(csv);
    expect(rows[0]!.zipCode).toBe('05001');
  });

  it('maps blank STATE_USPS to null (territorial ZCTAs)', () => {
    const csv = ['ZCTA5,LAT,LNG,STATE_USPS', '00601,18.18,-66.75,'].join('\n');
    const rows = parseZipCentroidCsv(csv);
    expect(rows[0]!.state).toBeNull();
  });
});

describe('upsert paths (Prisma-backed)', () => {
  let db: TestDb;

  beforeAll(async () => { db = await createTestDb(); });
  afterAll(() => db.dispose());

  const siteRows: SuperfundRow[] = [
    { epaId: 'S1', name: 'Alpha', city: null, county: null, state: 'FL',
      zipCode: null, latitude: 25, longitude: -80, status: 'final',
      listedOn: null, deletedOn: null, contaminants: null, epaUrl: null },
    { epaId: 'S2', name: 'Beta', city: 'Reno', county: 'Washoe', state: 'NV',
      zipCode: '89501', latitude: 39, longitude: -119, status: 'deleted',
      listedOn: null, deletedOn: null, contaminants: null, epaUrl: null },
  ];

  const zipRows: ZipCentroidRow[] = [
    { zipCode: '33130', latitude: 25.76, longitude: -80.19, state: 'FL' },
    { zipCode: '89501', latitude: 39.52, longitude: -119.81, state: 'NV' },
  ];

  it('createMany fast path runs on an empty table and reports all-inserted', async () => {
    const summary = await upsertSuperfundSites(db.prisma, siteRows);
    expect(summary).toEqual({ inserted: 2, updated: 0, orphans: 0 });
    expect(await db.prisma.superfundSite.count()).toBe(2);
  });

  it('re-running goes through upsert path and reports all-updated', async () => {
    const mutated = siteRows.map((r) => ({ ...r, name: `${r.name} v2` }));
    const summary = await upsertSuperfundSites(db.prisma, mutated);
    expect(summary).toEqual({ inserted: 0, updated: 2, orphans: 0 });
    const all = await db.prisma.superfundSite.findMany({ orderBy: { epaId: 'asc' } });
    expect(all.map((s) => s.name)).toEqual(['Alpha v2', 'Beta v2']);
  });

  it('reports orphans — rows in DB no longer in the CSV', async () => {
    const summary = await upsertSuperfundSites(db.prisma, [siteRows[0]!]);
    expect(summary.orphans).toBe(1);
  });

  it('upsertZipCentroids fast path + re-seed path', async () => {
    const first = await upsertZipCentroids(db.prisma, zipRows);
    expect(first).toEqual({ inserted: 2, updated: 0, orphans: 0 });

    const mutated = zipRows.map((r) => ({ ...r, latitude: r.latitude + 0.01 }));
    const second = await upsertZipCentroids(db.prisma, mutated);
    expect(second.updated).toBe(2);
    expect(second.inserted).toBe(0);
  });

  it('upsertZipCentroids orphan count matches removed rows', async () => {
    const summary = await upsertZipCentroids(db.prisma, [zipRows[0]!]);
    expect(summary.orphans).toBe(1);
  });
});

describe('seedSuperfundIfEmpty', () => {
  let db: TestDb;
  beforeAll(async () => {
    db = await createTestDb();
    await db.prisma.superfundSite.create({
      data: { epaId: 'X', name: 'X', state: 'FL', latitude: 0, longitude: 0, status: 'final' },
    });
    await db.prisma.zipCentroid.create({
      data: { zipCode: '00000', latitude: 0, longitude: 0, state: 'FL' },
    });
  });
  afterAll(() => db.dispose());

  it('short-circuits when both tables are populated (no CSV read)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    await seedSuperfundIfEmpty(db.prisma);
    expect(spy).toHaveBeenCalledWith('[superfund] tables populated, skipping auto-seed');
    spy.mockRestore();
  });
});

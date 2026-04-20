# Superfund Sites Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add EPA NPL Superfund site reference data to the intake app: seed two Prisma tables, expose two reference-data endpoints, auto-compute sites within 10 mi of the submitted ZIP at submission time, and add a per-state "historical residency near Superfund sites" intake UI.

**Architecture:** Two plaintext Prisma tables (`SuperfundSite`, `ZipCentroid`) seeded from committed CSV snapshots. Proximity runs server-side inside `POST /api/submissions` using ZIP-centroid distance. Historical residency is collected in the intake UI as `StateResidency[]`, posted alongside the submission, and the server enriches the markdown + sections JSON before encryption. Reference endpoints are auth-gated but not audited (public EPA data).

**Tech Stack:** Angular 21 (standalone, signals), Express 5, Prisma 7 + SQLite, Zod, `csv-parse` (new), vitest.

---

## File structure

**New files:**

- `prisma/data/superfund-sites.csv` — EPA NPL snapshot (Final + Proposed + Deleted).
- `prisma/data/zip-centroids.csv` — U.S. Census 2020 ZCTA gazetteer snapshot.
- `server/superfund-importer.ts` — CSV → DB idempotent upsert logic.
- `server/superfund-importer.spec.ts` — unit tests for parser + upsert semantics.
- `server/superfund-proximity.ts` — `nearbySites(prisma, zipCode)` pure function.
- `server/superfund-proximity.spec.ts` — unit tests for distance logic.
- `server/superfund-emission.ts` — `buildProximityBlock()` + `buildHistoricalBlock()` markdown/sections rendering.
- `server/superfund-emission.spec.ts` — unit tests for rendering.
- `scripts/seed-superfund.ts` — CLI entry: `pnpm superfund:seed`.
- `src/app/shared/superfund.service.ts` — Angular service wrapping the two API calls, signal-cached per state.
- `src/app/intake-form/state-residency/state-residency.component.ts` + `.html` — per-state panel.

**Modified files:**

- `prisma/schema.prisma` — add `SuperfundSite`, `ZipCentroid` models.
- `package.json` — add `csv-parse` dep + `superfund:seed` script.
- `src/server.ts` — call `seedSuperfundIfEmpty` on boot; extend `POST /api/submissions` with proximity + historical enrichment.
- `server/admin-routes.ts` — add `GET /api/superfund/states` and `GET /api/superfund/sites`.
- `server/anonymize.ts` — accept `livedInStates` in the incoming payload Zod schema.
- `src/app/risk/risk.model.ts` — add `StateResidency` + `livedInStates` to `EnvironmentalExposure`; update `EMPTY_INTAKE`.
- `src/app/risk/risk.service.ts` — bump `SCHEMA_VERSION` to `1.1.0`.
- `src/app/intake-form/intake-form.component.ts` + `.html` — add "states you've lived in" multi-select + per-state panels.
- `src/app/icons.ts` — add `faHouseChimney` / `faMapLocationDot` icons (or equivalent already present).

---

## Task 1: Add csv-parse dependency and commit CSV snapshots

**Files:**
- Modify: `package.json` (add `csv-parse` to dependencies)
- Create: `prisma/data/superfund-sites.csv`
- Create: `prisma/data/zip-centroids.csv`
- Create: `prisma/data/README.md` (document source URLs and refresh procedure)

- [ ] **Step 1: Install csv-parse**

Run: `pnpm add csv-parse`
Expected: `package.json` shows `"csv-parse": "^5.x.x"` under `dependencies`.

- [ ] **Step 2: Fetch and commit the EPA NPL dataset**

Use WebFetch (or ask the human to download) from the EPA public dataset page:

- URL: `https://www.epa.gov/superfund/national-priorities-list-npl-sites-state` (page links to CSV/Excel downloads).
- Alternative (direct CSV): EPA's Envirofacts SEMS NPL extract. As of this spec, EPA publishes an NPL CSV under `https://semspub.epa.gov/src/document/HQ/100001744` (Excel) or via the Envirofacts REST API.
- Target size: ~1,900 rows for Final + Proposed + Deleted.

Save to `prisma/data/superfund-sites.csv`. The importer (Task 3) will tolerate the EPA column layout; if the file's headers differ from what's expected there, update the column-name constants in the importer rather than hand-massaging the CSV.

Expected columns (rename via the importer if EPA's are different):
`EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL`

If the real EPA export doesn't include `CONTAMINANTS` as a single column, leave it blank in the CSV; a future refresh can backfill it from the SEMS contaminants table.

- [ ] **Step 3: Fetch and commit the ZIP-centroid dataset**

Source: U.S. Census Bureau 2020 ZCTA Gazetteer file.

- URL: `https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip`
- Unzip → convert the tab-delimited `.txt` to CSV with columns `ZCTA5,LAT,LNG,STATE_USPS`.

Save the CSV form to `prisma/data/zip-centroids.csv`. The state-USPS code must come from a ZIP→state mapping (the Gazetteer file lacks state in some years — if so, use a supplementary ZIP-to-state file, e.g. HUD's USPS ZIP Crosswalk, and merge it in at CSV-build time).

Expected size: ~33k rows, ~1 MB.

- [ ] **Step 4: Write `prisma/data/README.md`**

```markdown
# Reference data snapshots

Both files here are static, public-domain reference data.

## superfund-sites.csv

Source: EPA National Priorities List (Final + Proposed + Deleted).
Landing page: https://www.epa.gov/superfund/national-priorities-list-npl-sites-state

Refresh procedure:
1. Download the latest NPL export from the landing page above.
2. Convert to CSV with these columns:
   EPA_ID, SITE_NAME, CITY, COUNTY, STATE, ZIP_CODE, LATITUDE, LONGITUDE,
   STATUS, LISTED_DATE, DELETED_DATE, CONTAMINANTS, EPA_URL
3. Replace this file; run `pnpm superfund:seed`.

## zip-centroids.csv

Source: U.S. Census Bureau 2020 ZCTA Gazetteer file.
URL: https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip

Columns: ZCTA5, LAT, LNG, STATE_USPS

Refresh procedure: re-download + re-merge with HUD USPS ZIP-to-state crosswalk
if the Gazetteer release omits state, commit the CSV, run `pnpm superfund:seed`.
```

- [ ] **Step 5: Verify files are committed and tracked**

Run: `git status prisma/data/ && wc -l prisma/data/*.csv`
Expected: both CSVs listed as untracked (ready to add); `superfund-sites.csv` has ~1,900 lines + header; `zip-centroids.csv` has ~33,000 lines + header.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml prisma/data/
git commit -m "feat: add csv-parse dep and EPA/Census reference data snapshots"
```

---

## Task 2: Prisma schema — add SuperfundSite and ZipCentroid

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Append the two models to `prisma/schema.prisma`**

Add after the existing `AuditLog` model:

```prisma
// EPA National Priorities List (Superfund) site reference data.
// Public (non-PHI). Seeded from prisma/data/superfund-sites.csv via
// scripts/seed-superfund.ts. Not scoped to users.
model SuperfundSite {
  id           String    @id @default(uuid())
  epaId        String    @unique
  name         String
  city         String?
  county       String?
  state        String
  zipCode      String?
  latitude     Float
  longitude    Float
  status       String    // 'final' | 'proposed' | 'deleted' | 'partial-deletion'
  listedOn     DateTime?
  deletedOn    DateTime?
  contaminants String?   // comma-separated best-effort list
  epaUrl       String?
  updatedAt    DateTime  @updatedAt
  createdAt    DateTime  @default(now())

  @@index([state, name])
  @@index([latitude, longitude])
}

// U.S. Census 2020 ZCTA Gazetteer snapshot. Public reference data;
// used for ZIP-centroid distance computation against SuperfundSite.
model ZipCentroid {
  zipCode   String @id
  latitude  Float
  longitude Float
  state     String
}
```

- [ ] **Step 2: Run the migration**

Run: `pnpm prisma migrate dev --name add_superfund_sites_and_zip_centroids`
Expected: a new migration directory under `prisma/migrations/` containing the `CREATE TABLE` statements for both models, and Prisma client regenerated (`server/generated/prisma/`).

- [ ] **Step 3: Smoke-test the generated client**

Run: `pnpm tsc --noEmit`
Expected: no type errors; `PrismaClient` now has `superfundSite` and `zipCentroid` delegate properties.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/ server/generated/
git commit -m "feat: add SuperfundSite and ZipCentroid tables"
```

---

## Task 3: Importer module with unit tests

**Files:**
- Create: `server/superfund-importer.ts`
- Create: `server/superfund-importer.spec.ts`

- [ ] **Step 1: Write failing tests for CSV parsing**

Create `server/superfund-importer.spec.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { parseSuperfundCsv, parseZipCentroidCsv } from './superfund-importer.js';

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

  it('throws on unparseable rows', () => {
    const csv = [
      'EPA_ID,SITE_NAME,CITY,COUNTY,STATE,ZIP_CODE,LATITUDE,LONGITUDE,STATUS,LISTED_DATE,DELETED_DATE,CONTAMINANTS,EPA_URL',
      'A,B,C,D,FL,12345,not-a-number,-82,final,1983-09-08,,,',
    ].join('\n');
    expect(() => parseSuperfundCsv(csv)).toThrow(/latitude/i);
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
    expect(rows[0].zipCode).toBe('05001');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm vitest run server/superfund-importer.spec.ts`
Expected: FAIL — `parseSuperfundCsv` and `parseZipCentroidCsv` are not exported.

- [ ] **Step 3: Implement `server/superfund-importer.ts`**

```ts
import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { PrismaClient } from './generated/prisma/client.js';

export interface SuperfundRow {
  epaId: string;
  name: string;
  city: string | null;
  county: string | null;
  state: string;
  zipCode: string | null;
  latitude: number;
  longitude: number;
  status: string;
  listedOn: Date | null;
  deletedOn: Date | null;
  contaminants: string | null;
  epaUrl: string | null;
}

export interface ZipCentroidRow {
  zipCode: string;
  latitude: number;
  longitude: number;
  state: string;
}

const VALID_STATUSES = new Set(['final', 'proposed', 'deleted', 'partial-deletion']);

function normalizeStatus(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (s.includes('partial')) return 'partial-deletion';
  if (s.startsWith('del')) return 'deleted';
  if (s.startsWith('prop')) return 'proposed';
  if (s.startsWith('fin') || s.startsWith('npl')) return 'final';
  if (VALID_STATUSES.has(s)) return s;
  throw new Error(`unknown Superfund status: ${raw}`);
}

function parseDateOrNull(raw: string | undefined): Date | null {
  if (!raw || !raw.trim()) return null;
  const d = new Date(raw.trim());
  if (Number.isNaN(d.getTime())) throw new Error(`unparseable date: ${raw}`);
  return d;
}

function parseNumber(raw: string, field: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`invalid ${field}: ${raw}`);
  return n;
}

function emptyToNull(v: string | undefined): string | null {
  if (v === undefined) return null;
  const t = v.trim();
  return t.length === 0 ? null : t;
}

export function parseSuperfundCsv(csv: string): SuperfundRow[] {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  return records.map((r) => ({
    epaId: r['EPA_ID'],
    name: r['SITE_NAME'],
    city: emptyToNull(r['CITY']),
    county: emptyToNull(r['COUNTY']),
    state: r['STATE'].toUpperCase(),
    zipCode: emptyToNull(r['ZIP_CODE']),
    latitude: parseNumber(r['LATITUDE'], 'latitude'),
    longitude: parseNumber(r['LONGITUDE'], 'longitude'),
    status: normalizeStatus(r['STATUS']),
    listedOn: parseDateOrNull(r['LISTED_DATE']),
    deletedOn: parseDateOrNull(r['DELETED_DATE']),
    contaminants: emptyToNull(r['CONTAMINANTS']),
    epaUrl: emptyToNull(r['EPA_URL']),
  }));
}

export function parseZipCentroidCsv(csv: string): ZipCentroidRow[] {
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
  }) as Record<string, string>[];
  return records.map((r) => ({
    zipCode: r['ZCTA5'].padStart(5, '0'),
    latitude: parseNumber(r['LAT'], 'latitude'),
    longitude: parseNumber(r['LNG'], 'longitude'),
    state: r['STATE_USPS'].toUpperCase(),
  }));
}

interface SeedSummary {
  inserted: number;
  updated: number;
  unchanged: number;
  orphans: number;
}

async function upsertSuperfundSites(
  prisma: PrismaClient,
  rows: SuperfundRow[],
): Promise<SeedSummary> {
  const existingIds = new Set(
    (await prisma.superfundSite.findMany({ select: { epaId: true } })).map((s) => s.epaId),
  );
  let inserted = 0;
  let updated = 0;
  const rowIds = new Set(rows.map((r) => r.epaId));

  for (const row of rows) {
    const res = await prisma.superfundSite.upsert({
      where: { epaId: row.epaId },
      update: {
        name: row.name,
        city: row.city,
        county: row.county,
        state: row.state,
        zipCode: row.zipCode,
        latitude: row.latitude,
        longitude: row.longitude,
        status: row.status,
        listedOn: row.listedOn,
        deletedOn: row.deletedOn,
        contaminants: row.contaminants,
        epaUrl: row.epaUrl,
      },
      create: row,
    });
    if (existingIds.has(res.epaId)) updated++;
    else inserted++;
  }

  const orphans = [...existingIds].filter((id) => !rowIds.has(id)).length;
  return { inserted, updated, unchanged: 0, orphans };
}

async function upsertZipCentroids(
  prisma: PrismaClient,
  rows: ZipCentroidRow[],
): Promise<SeedSummary> {
  const existingIds = new Set(
    (await prisma.zipCentroid.findMany({ select: { zipCode: true } })).map((z) => z.zipCode),
  );
  let inserted = 0;
  let updated = 0;

  const chunkSize = 500;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    for (const row of chunk) {
      await prisma.zipCentroid.upsert({
        where: { zipCode: row.zipCode },
        update: { latitude: row.latitude, longitude: row.longitude, state: row.state },
        create: row,
      });
      if (existingIds.has(row.zipCode)) updated++;
      else inserted++;
    }
  }

  const rowIds = new Set(rows.map((r) => r.zipCode));
  const orphans = [...existingIds].filter((id) => !rowIds.has(id)).length;
  return { inserted, updated, unchanged: 0, orphans };
}

function dataPath(filename: string): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '..', 'prisma', 'data', filename);
}

function loadCsvs(): { sites: SuperfundRow[]; zips: ZipCentroidRow[] } {
  const sitesCsv = readFileSync(dataPath('superfund-sites.csv'), 'utf8');
  const zipsCsv = readFileSync(dataPath('zip-centroids.csv'), 'utf8');
  return { sites: parseSuperfundCsv(sitesCsv), zips: parseZipCentroidCsv(zipsCsv) };
}

export async function seedSuperfundForce(prisma: PrismaClient): Promise<void> {
  const { sites, zips } = loadCsvs();
  const siteSummary = await upsertSuperfundSites(prisma, sites);
  const zipSummary = await upsertZipCentroids(prisma, zips);
  console.log(
    `[superfund] sites: ${siteSummary.inserted} inserted, ${siteSummary.updated} updated, ${siteSummary.orphans} in DB but not in CSV (left alone)`,
  );
  console.log(
    `[superfund] zip centroids: ${zipSummary.inserted} inserted, ${zipSummary.updated} updated, ${zipSummary.orphans} in DB but not in CSV (left alone)`,
  );
}

export async function seedSuperfundIfEmpty(prisma: PrismaClient): Promise<void> {
  const [siteCount, zipCount] = await Promise.all([
    prisma.superfundSite.count(),
    prisma.zipCentroid.count(),
  ]);
  if (siteCount > 0 && zipCount > 0) {
    console.log('[superfund] tables populated, skipping auto-seed');
    return;
  }
  console.log(`[superfund] auto-seeding (sites=${siteCount}, zips=${zipCount})`);
  await seedSuperfundForce(prisma);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run server/superfund-importer.spec.ts`
Expected: PASS — all three `parseSuperfundCsv` tests and both `parseZipCentroidCsv` tests pass.

- [ ] **Step 5: Commit**

```bash
git add server/superfund-importer.ts server/superfund-importer.spec.ts
git commit -m "feat: add Superfund/ZIP-centroid CSV importer with upsert semantics"
```

---

## Task 4: CLI seeder script + boot wiring

**Files:**
- Create: `scripts/seed-superfund.ts`
- Modify: `package.json`
- Modify: `src/server.ts`

- [ ] **Step 1: Write the CLI script**

Create `scripts/seed-superfund.ts`:

```ts
import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../server/generated/prisma/client.js';
import { seedSuperfundForce } from '../server/superfund-importer.js';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'] ?? 'file:./dev.db';
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await seedSuperfundForce(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-superfund] failed:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the `superfund:seed` script to `package.json`**

Inside the `"scripts"` block, add:

```json
"superfund:seed": "tsx scripts/seed-superfund.ts"
```

If `tsx` isn't already a dev dependency, add it:

Run: `pnpm add -D tsx`
Expected: `tsx` appears in `devDependencies`.

- [ ] **Step 3: Wire `seedSuperfundIfEmpty` into `src/server.ts`**

In `src/server.ts`, after `const prisma = new PrismaClient({ adapter });` (around line 30), and before `const crypto = cryptoFromEnv();`, add:

```ts
import { seedSuperfundIfEmpty } from '../server/superfund-importer.js';

// Kick off async Superfund/ZIP reference-data seeding on boot. Non-blocking —
// the app starts immediately; seeding logs progress. Endpoints that query
// these tables handle the "still seeding" window by returning an empty list.
void seedSuperfundIfEmpty(prisma).catch((err) => {
  console.error('[superfund] auto-seed failed:', err);
});
```

Put the `import` near the other local server imports (above the `adminRouter` import).

- [ ] **Step 4: Manually test the seeder**

Run: `pnpm superfund:seed`
Expected output (approximately):
```
[superfund] sites: 1900 inserted, 0 updated, 0 in DB but not in CSV (left alone)
[superfund] zip centroids: 33120 inserted, 0 updated, 0 in DB but not in CSV (left alone)
```

- [ ] **Step 5: Re-run to verify idempotency**

Run: `pnpm superfund:seed` (second time)
Expected:
```
[superfund] sites: 0 inserted, 1900 updated, 0 in DB but not in CSV (left alone)
[superfund] zip centroids: 0 inserted, 33120 updated, 0 in DB but not in CSV (left alone)
```

- [ ] **Step 6: Commit**

```bash
git add scripts/ package.json pnpm-lock.yaml src/server.ts
git commit -m "feat: add pnpm superfund:seed + auto-seed on empty DB"
```

---

## Task 5: Proximity helper with unit tests

**Files:**
- Create: `server/superfund-proximity.ts`
- Create: `server/superfund-proximity.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `server/superfund-proximity.spec.ts`:

```ts
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
    expect(d).toBeLessThan(7.0);
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
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run server/superfund-proximity.spec.ts`
Expected: FAIL — `haversineMiles` and `bboxBounds` are not exported.

- [ ] **Step 3: Implement `server/superfund-proximity.ts`**

```ts
import type { PrismaClient } from './generated/prisma/client.js';

const EARTH_RADIUS_MILES = 3958.7613;
export const PROXIMITY_MILES = 10;

export interface NearbySite {
  id: string;
  epaId: string;
  name: string;
  city: string | null;
  county: string | null;
  state: string;
  status: string;
  contaminants: string | null;
  distanceMiles: number;
}

export function haversineMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_MILES * c;
}

export function bboxBounds(lat: number, _lng: number, radiusMiles: number) {
  // 1 degree of latitude ≈ 69 miles, essentially constant.
  const latDelta = radiusMiles / 69;
  // 1 degree of longitude shrinks as cos(latitude). Guard against poles.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusMiles / (69 * cosLat);
  return { latDelta, lngDelta };
}

export async function nearbySites(
  prisma: PrismaClient,
  zipCode: string,
  radiusMiles: number = PROXIMITY_MILES,
): Promise<NearbySite[]> {
  const centroid = await prisma.zipCentroid.findUnique({ where: { zipCode } });
  if (!centroid) return [];

  const { latDelta, lngDelta } = bboxBounds(centroid.latitude, centroid.longitude, radiusMiles + 5);
  const candidates = await prisma.superfundSite.findMany({
    where: {
      latitude: { gte: centroid.latitude - latDelta, lte: centroid.latitude + latDelta },
      longitude: { gte: centroid.longitude - lngDelta, lte: centroid.longitude + lngDelta },
    },
    select: {
      id: true,
      epaId: true,
      name: true,
      city: true,
      county: true,
      state: true,
      latitude: true,
      longitude: true,
      status: true,
      contaminants: true,
    },
  });

  const within = candidates
    .map((s) => ({
      id: s.id,
      epaId: s.epaId,
      name: s.name,
      city: s.city,
      county: s.county,
      state: s.state,
      status: s.status,
      contaminants: s.contaminants,
      distanceMiles: haversineMiles(centroid.latitude, centroid.longitude, s.latitude, s.longitude),
    }))
    .filter((s) => s.distanceMiles <= radiusMiles)
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return within;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run server/superfund-proximity.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/superfund-proximity.ts server/superfund-proximity.spec.ts
git commit -m "feat: add ZIP-centroid Superfund proximity helper"
```

---

## Task 6: Markdown + sections emission helpers with unit tests

**Files:**
- Create: `server/superfund-emission.ts`
- Create: `server/superfund-emission.spec.ts`

- [ ] **Step 1: Write failing tests**

Create `server/superfund-emission.spec.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  buildProximityMarkdown,
  buildProximitySection,
  buildHistoricalMarkdown,
  buildHistoricalSection,
} from './superfund-emission.js';

describe('buildProximityMarkdown', () => {
  it('emits a sentinel line when no sites match', () => {
    const md = buildProximityMarkdown({ zipCode: '33130', zipCentroidFound: true, sites: [] });
    expect(md).toContain('No NPL-listed Superfund sites within 10 miles');
  });

  it('emits a sentinel line when the ZIP centroid is missing', () => {
    const md = buildProximityMarkdown({ zipCode: '99999', zipCentroidFound: false, sites: [] });
    expect(md).toContain('ZIP centroid unavailable; proximity not computed');
  });

  it('renders each site with distance, status, and contaminants', () => {
    const md = buildProximityMarkdown({
      zipCode: '33130',
      zipCentroidFound: true,
      sites: [
        { epaId: 'A', name: 'Miami Airport', distanceMiles: 2.34, status: 'final',
          contaminants: 'TCE, vinyl chloride', city: null, county: null, state: 'FL' },
      ],
    });
    expect(md).toContain('Miami Airport');
    expect(md).toContain('2.3 mi away');
    expect(md).toContain('status: final');
    expect(md).toContain('TCE, vinyl chloride');
  });
});

describe('buildProximitySection', () => {
  it('emits structured section with zip + sites', () => {
    const s = buildProximitySection({
      zipCode: '33130',
      zipCentroidFound: true,
      sites: [
        { epaId: 'A', name: 'X', distanceMiles: 1, status: 'final',
          contaminants: 'PCE', city: 'C', county: 'D', state: 'FL' },
      ],
    });
    expect(s).toEqual({
      zipCode: '33130',
      zipCentroidFound: true,
      sitesWithin10Mi: [
        { epaId: 'A', name: 'X', distanceMiles: 1, status: 'final', contaminants: 'PCE' },
      ],
    });
  });
});

describe('buildHistoricalMarkdown', () => {
  it('returns empty string when no states provided', () => {
    expect(buildHistoricalMarkdown([])).toBe('');
  });

  it('omits states with no selected sites', () => {
    const md = buildHistoricalMarkdown([
      { state: 'FL', stateName: 'Florida', livedYears: 5, sites: [] },
    ]);
    expect(md).toBe('');
  });

  it('renders states with year counts and site lines', () => {
    const md = buildHistoricalMarkdown([
      {
        state: 'FL',
        stateName: 'Florida',
        livedYears: 12,
        sites: [
          { epaId: 'A', name: 'Helena Chemical Co', city: 'Tampa', county: 'Hillsborough',
            status: 'final', contaminants: 'arsenic, lead' },
        ],
      },
    ]);
    expect(md).toContain('### Historical residency near Superfund sites');
    expect(md).toContain('**Florida** (~12 years)');
    expect(md).toContain('Helena Chemical Co');
    expect(md).toContain('Tampa, Hillsborough');
    expect(md).toContain('arsenic, lead');
  });

  it('omits year count when null', () => {
    const md = buildHistoricalMarkdown([
      {
        state: 'FL',
        stateName: 'Florida',
        livedYears: null,
        sites: [
          { epaId: 'A', name: 'X', city: 'C', county: 'D', status: 'final', contaminants: null },
        ],
      },
    ]);
    expect(md).toContain('**Florida**');
    expect(md).not.toContain('years)');
  });
});

describe('buildHistoricalSection', () => {
  it('returns the structured equivalent of the markdown', () => {
    const s = buildHistoricalSection([
      {
        state: 'FL',
        stateName: 'Florida',
        livedYears: 12,
        sites: [
          { epaId: 'A', name: 'X', city: 'C', county: 'D', status: 'final', contaminants: 'arsenic' },
        ],
      },
    ]);
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ state: 'FL', livedYears: 12 });
    expect(s[0].sites).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm vitest run server/superfund-emission.spec.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `server/superfund-emission.ts`**

```ts
export interface ProximityInput {
  zipCode: string;
  zipCentroidFound: boolean;
  sites: {
    epaId: string;
    name: string;
    city: string | null;
    county: string | null;
    state: string;
    status: string;
    contaminants: string | null;
    distanceMiles: number;
  }[];
}

export interface ProximitySection {
  zipCode: string;
  zipCentroidFound: boolean;
  sitesWithin10Mi: {
    epaId: string;
    name: string;
    distanceMiles: number;
    status: string;
    contaminants: string | null;
  }[];
}

export interface HistoricalStateInput {
  state: string;      // 2-letter
  stateName: string;  // "Florida"
  livedYears: number | null;
  sites: {
    epaId: string;
    name: string;
    city: string | null;
    county: string | null;
    status: string;
    contaminants: string | null;
  }[];
}

export interface HistoricalSectionEntry {
  state: string;
  stateName: string;
  livedYears: number | null;
  sites: {
    epaId: string;
    name: string;
    city: string | null;
    county: string | null;
    status: string;
    contaminants: string | null;
  }[];
}

function formatMeta(status: string, contaminants: string | null): string {
  const parts = [`status: ${status}`];
  if (contaminants) parts.push(`contaminants: ${contaminants}`);
  return parts.join('; ');
}

export function buildProximityMarkdown(input: ProximityInput): string {
  const lines: string[] = ['### Current residence — Superfund sites within 10 miles', ''];
  if (!input.zipCentroidFound) {
    lines.push('ZIP centroid unavailable; proximity not computed.');
    return lines.join('\n');
  }
  if (input.sites.length === 0) {
    lines.push('No NPL-listed Superfund sites within 10 miles of submitted ZIP.');
    return lines.join('\n');
  }
  for (const s of input.sites) {
    const distance = s.distanceMiles.toFixed(1);
    lines.push(`- ${s.name} — ${distance} mi away (${formatMeta(s.status, s.contaminants)})`);
  }
  return lines.join('\n');
}

export function buildProximitySection(input: ProximityInput): ProximitySection {
  return {
    zipCode: input.zipCode,
    zipCentroidFound: input.zipCentroidFound,
    sitesWithin10Mi: input.sites.map((s) => ({
      epaId: s.epaId,
      name: s.name,
      distanceMiles: Number(s.distanceMiles.toFixed(2)),
      status: s.status,
      contaminants: s.contaminants,
    })),
  };
}

export function buildHistoricalMarkdown(states: HistoricalStateInput[]): string {
  const populated = states.filter((s) => s.sites.length > 0);
  if (populated.length === 0) return '';

  const lines: string[] = ['### Historical residency near Superfund sites', ''];
  for (const s of populated) {
    const header = s.livedYears != null
      ? `- **${s.stateName}** (~${s.livedYears} years)`
      : `- **${s.stateName}**`;
    lines.push(header);
    for (const site of s.sites) {
      const loc = [site.city, site.county].filter(Boolean).join(', ');
      const suffix = loc ? ` — ${loc}` : '';
      lines.push(`  - ${site.name}${suffix} (${formatMeta(site.status, site.contaminants)})`);
    }
  }
  return lines.join('\n');
}

export function buildHistoricalSection(states: HistoricalStateInput[]): HistoricalSectionEntry[] {
  return states
    .filter((s) => s.sites.length > 0)
    .map((s) => ({
      state: s.state,
      stateName: s.stateName,
      livedYears: s.livedYears,
      sites: s.sites.map((site) => ({
        epaId: site.epaId,
        name: site.name,
        city: site.city,
        county: site.county,
        status: site.status,
        contaminants: site.contaminants,
      })),
    }));
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run server/superfund-emission.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/superfund-emission.ts server/superfund-emission.spec.ts
git commit -m "feat: add Superfund markdown/section rendering helpers"
```

---

## Task 7: Reference-data API endpoints

**Files:**
- Modify: `server/admin-routes.ts`

- [ ] **Step 1: Add endpoints to `server/admin-routes.ts`**

Locate the section where other `router.get` endpoints live (near the top of the routes, e.g. around `/api/auth/me`). Add this block, preferably grouped together after the auth endpoints but before the admin/patient submission endpoints:

```ts
  // --- Superfund reference data (public EPA data, auth-gated, not audited) ---

  router.get('/api/superfund/states', requireAuth, async (_req, res) => {
    const rows = await prisma.superfundSite.groupBy({
      by: ['state'],
      _count: { _all: true },
      orderBy: { state: 'asc' },
    });
    const states = rows.map((r) => ({ state: r.state, siteCount: r._count._all }));
    res.json({ ok: true, states });
  });

  const stateQuerySchema = z.object({
    state: z.string().regex(/^[A-Z]{2}$/, 'must be 2 uppercase letters'),
  });

  router.get('/api/superfund/sites', requireAuth, async (req, res) => {
    const parsed = stateQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ ok: false, errors: issuesToErrors(parsed.error.issues) });
      return;
    }
    const sites = await prisma.superfundSite.findMany({
      where: { state: parsed.data.state },
      select: {
        id: true,
        epaId: true,
        name: true,
        city: true,
        county: true,
        zipCode: true,
        status: true,
        contaminants: true,
        epaUrl: true,
      },
      orderBy: { name: 'asc' },
    });
    res.json({ ok: true, sites });
  });
```

`z`, `requireAuth`, and `issuesToErrors` are already imported at the top of the file — no new imports needed.

- [ ] **Step 2: Manual smoke test — states endpoint**

Start the dev server and hit the endpoint while logged in. Use a saved cookie or curl with a valid session cookie:

Run: `curl -s -b cookies.txt http://localhost:4000/api/superfund/states | jq '.states | length'`
Expected: a number matching the count of distinct states with sites (~50).

Unauthenticated:
Run: `curl -s http://localhost:4000/api/superfund/states | jq`
Expected: `{ "ok": false, "errors": [{ "field": "auth", "reason": "unauthorized" }] }` (or whatever the existing `requireAuth` shape is).

- [ ] **Step 3: Manual smoke test — sites endpoint**

Run: `curl -s -b cookies.txt 'http://localhost:4000/api/superfund/sites?state=FL' | jq '.sites | length'`
Expected: a number matching the number of FL sites.

Invalid state:
Run: `curl -s -b cookies.txt 'http://localhost:4000/api/superfund/sites?state=xx' | jq`
Expected: `{ "ok": false, "errors": [{ "field": "state", "reason": "must be 2 uppercase letters" }] }`.

- [ ] **Step 4: Commit**

```bash
git add server/admin-routes.ts
git commit -m "feat: add GET /api/superfund/states and /api/superfund/sites"
```

---

## Task 8: Accept `livedInStates` in submission payload and enrich server-side

**Files:**
- Modify: `server/anonymize.ts`
- Modify: `src/server.ts`

- [ ] **Step 1: Extend the submission Zod schema in `server/anonymize.ts`**

Replace the `submissionSchema` definition (currently lines ~30–41) with:

```ts
const stateResidencySchema = z.object({
  state: z.string().regex(/^[A-Z]{2}$/),
  livedYears: z.number().int().min(0).max(120).nullable(),
  nearSiteIds: z.array(z.string().uuid()).max(500),
});

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
  livedInStates: z.array(stateResidencySchema).max(55).default([]),
});
```

No other changes to the file — `IncomingPayload` / `validateAndSanitize` are unchanged structurally.

- [ ] **Step 2: Rewrite `POST /api/submissions` in `src/server.ts` to enrich server-side**

Replace the existing handler (around lines 154–186) with:

```ts
import { nearbySites } from '../server/superfund-proximity.js';
import {
  buildHistoricalMarkdown,
  buildHistoricalSection,
  buildProximityMarkdown,
  buildProximitySection,
  type HistoricalStateInput,
} from '../server/superfund-emission.js';

const US_STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};

app.post('/api/submissions', requireRole('patient'), async (req, res) => {
  const result = validateAndSanitize(req.body);
  if (!result.ok) {
    res.status(400).json({ ok: false, errors: result.errors });
    return;
  }
  const s = result.sanitized;

  // Compute current-proximity block (10 mi from ZIP centroid).
  let proximityMarkdown = '';
  let proximitySection: ReturnType<typeof buildProximitySection> | null = null;
  if (s.zipCode) {
    const sites = await nearbySites(prisma, s.zipCode.slice(0, 5));
    const centroid = await prisma.zipCentroid.findUnique({
      where: { zipCode: s.zipCode.slice(0, 5) },
      select: { zipCode: true },
    });
    proximityMarkdown = buildProximityMarkdown({
      zipCode: s.zipCode,
      zipCentroidFound: centroid !== null,
      sites,
    });
    proximitySection = buildProximitySection({
      zipCode: s.zipCode,
      zipCentroidFound: centroid !== null,
      sites,
    });
  }

  // Resolve historical residency site details.
  const allSiteIds = s.livedInStates.flatMap((st) => st.nearSiteIds);
  const historicalSiteRows = allSiteIds.length > 0
    ? await prisma.superfundSite.findMany({
        where: { id: { in: allSiteIds } },
        select: {
          id: true, epaId: true, name: true, city: true, county: true,
          status: true, contaminants: true,
        },
      })
    : [];
  const byId = new Map(historicalSiteRows.map((row) => [row.id, row]));
  const historicalInput: HistoricalStateInput[] = s.livedInStates.map((st) => ({
    state: st.state,
    stateName: US_STATE_NAMES[st.state] ?? st.state,
    livedYears: st.livedYears,
    sites: st.nearSiteIds
      .map((id) => byId.get(id))
      .filter((r): r is NonNullable<typeof r> => r !== undefined)
      .map((r) => ({
        epaId: r.epaId,
        name: r.name,
        city: r.city,
        county: r.county,
        status: r.status,
        contaminants: r.contaminants,
      })),
  }));
  const historicalMarkdown = buildHistoricalMarkdown(historicalInput);
  const historicalSection = buildHistoricalSection(historicalInput);

  const extraMarkdownChunks = [proximityMarkdown, historicalMarkdown].filter(Boolean);
  const markdown = extraMarkdownChunks.length > 0
    ? `${s.markdown}\n\n${extraMarkdownChunks.join('\n\n')}`
    : s.markdown;

  const sections = [
    ...s.sections,
    ...(proximitySection
      ? [{ id: 'environmental.superfundProximity.auto', data: proximitySection }]
      : []),
    ...(historicalSection.length > 0
      ? [{ id: 'environmental.superfundHistorical', data: historicalSection }]
      : []),
  ];

  const created = await prisma.submission.create({
    data: {
      lookupCode: createId(),
      schemaVersion: s.schemaVersion,
      ageBand: s.ageBand,
      sexAtBirth: s.sexAtBirth,
      zipCodeEnc: s.zipCode ? crypto.encrypt(s.zipCode) : null,
      markdownEnc: crypto.encrypt(markdown),
      sectionsEnc: crypto.encrypt(JSON.stringify(sections)),
      owner: { connect: { id: req.auth!.sub } },
    },
    select: { id: true, lookupCode: true, createdAt: true },
  });
  await audit(prisma, {
    action: 'submission_create',
    req,
    targetType: 'submission',
    targetId: created.id,
  });
  res.status(201).json({
    ok: true,
    id: created.id,
    lookupCode: created.lookupCode,
    createdAt: created.createdAt,
  });
});
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add server/anonymize.ts src/server.ts
git commit -m "feat: enrich submission markdown with Superfund proximity + history"
```

---

## Task 9: Client types + schema version bump + EMPTY_INTAKE update

**Files:**
- Modify: `src/app/risk/risk.model.ts`
- Modify: `src/app/risk/risk.service.ts`

- [ ] **Step 1: Add `StateResidency` to `risk.model.ts`**

Insert before the `EnvironmentalExposure` interface (around line 14):

```ts
export interface StateResidency {
  state: string;            // 2-letter USPS code
  livedYears: number | null;
  nearSiteIds: string[];    // SuperfundSite.id values
}
```

- [ ] **Step 2: Add `livedInStates` to `EnvironmentalExposure`**

Inside the `EnvironmentalExposure` interface (currently ends around line 47 with `leadPipeExposure`), add after `leadPipeExposure`:

```ts
  livedInStates: StateResidency[];
```

- [ ] **Step 3: Update `EMPTY_INTAKE`**

In `EMPTY_INTAKE.environmental` (around lines 150–174), add `livedInStates: [],` as the last property, e.g. after `leadPipeExposure: '',`.

- [ ] **Step 4: Bump `SCHEMA_VERSION` in `risk.service.ts`**

Change line 18 from `const SCHEMA_VERSION = '1.0.0';` to `const SCHEMA_VERSION = '1.1.0';`.

- [ ] **Step 5: Type-check**

Run: `pnpm tsc --noEmit`
Expected: no type errors. If the intake form HTML references unknown members they will surface here — no expected failures given these are additive changes.

- [ ] **Step 6: Commit**

```bash
git add src/app/risk/
git commit -m "feat: add StateResidency type and bump intake schema to 1.1.0"
```

---

## Task 10: Angular Superfund service

**Files:**
- Create: `src/app/shared/superfund.service.ts`

- [ ] **Step 1: Write the service**

```ts
import { Injectable, inject, signal, type Signal } from '@angular/core';
import { ApiClient } from './api-client';

export interface SuperfundStateInfo {
  state: string;
  siteCount: number;
}

export interface SuperfundSite {
  id: string;
  epaId: string;
  name: string;
  city: string | null;
  county: string | null;
  zipCode: string | null;
  status: string;
  contaminants: string | null;
  epaUrl: string | null;
}

@Injectable({ providedIn: 'root' })
export class SuperfundService {
  private api = inject(ApiClient);
  private statesCache = signal<SuperfundStateInfo[] | null>(null);
  private siteCache = new Map<string, Signal<SuperfundSite[] | null>>();

  readonly states = this.statesCache.asReadonly();

  async loadStates(): Promise<void> {
    if (this.statesCache() !== null) return;
    const res = await this.api.get<{ ok: true; states: SuperfundStateInfo[] }>(
      '/api/superfund/states',
    );
    this.statesCache.set(res.states);
  }

  sites(state: string): Signal<SuperfundSite[] | null> {
    const key = state.toUpperCase();
    const existing = this.siteCache.get(key);
    if (existing) return existing;
    const s = signal<SuperfundSite[] | null>(null);
    this.siteCache.set(key, s);
    void this.api
      .get<{ ok: true; sites: SuperfundSite[] }>(`/api/superfund/sites?state=${key}`)
      .then((res) => s.set(res.sites))
      .catch((err) => {
        console.error('[superfund.service] sites load failed', err);
        s.set([]);
      });
    return s;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `pnpm tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add src/app/shared/superfund.service.ts
git commit -m "feat: add SuperfundService with signal-backed per-state cache"
```

---

## Task 11: State-residency sub-component

**Files:**
- Create: `src/app/intake-form/state-residency/state-residency.component.ts`
- Create: `src/app/intake-form/state-residency/state-residency.component.html`

- [ ] **Step 1: Write the component class**

```ts
import { CommonModule } from '@angular/common';
import { Component, computed, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { SuperfundService, type SuperfundSite } from '../../shared/superfund.service';

@Component({
  selector: 'app-state-residency',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './state-residency.component.html',
})
export class StateResidencyComponent {
  private superfund = inject(SuperfundService);

  state = input.required<string>();
  stateName = input.required<string>();
  livedYears = model<number | null>(null);
  nearSiteIds = model<string[]>([]);
  removed = output<void>();

  private sitesSignal = computed(() => this.superfund.sites(this.state()));
  sites = computed<SuperfundSite[]>(() => this.sitesSignal()() ?? []);

  search = model<string>('');

  filteredSites = computed<SuperfundSite[]>(() => {
    const q = this.search().trim().toLowerCase();
    const all = this.sites();
    if (!q) return all;
    return all.filter((s) =>
      s.name.toLowerCase().includes(q)
      || (s.city ?? '').toLowerCase().includes(q)
      || (s.county ?? '').toLowerCase().includes(q),
    );
  });

  checkedCount = computed(() => this.nearSiteIds().length);

  isChecked(siteId: string): boolean {
    return this.nearSiteIds().includes(siteId);
  }

  toggleSite(siteId: string, checked: boolean): void {
    const current = this.nearSiteIds();
    if (checked && !current.includes(siteId)) {
      this.nearSiteIds.set([...current, siteId]);
    } else if (!checked && current.includes(siteId)) {
      this.nearSiteIds.set(current.filter((id) => id !== siteId));
    }
  }
}
```

- [ ] **Step 2: Write the template**

Create `src/app/intake-form/state-residency/state-residency.component.html`:

```html
<fieldset class="rounded border border-slate-300 p-4">
  <legend class="px-2 text-sm font-semibold">
    {{ stateName() }}
    <button type="button" class="ml-2 text-xs text-red-600 underline" (click)="removed.emit()">
      remove
    </button>
  </legend>

  <label class="mt-2 block text-sm">
    About how many years total?
    <input
      type="number"
      min="0"
      max="120"
      class="mt-1 block w-32 rounded border px-2 py-1"
      [ngModel]="livedYears()"
      (ngModelChange)="livedYears.set($event)"
      name="livedYears-{{ state() }}"
    />
  </label>

  <label class="mt-4 block text-sm font-medium">
    Search sites in {{ stateName() }}
    <input
      type="search"
      class="mt-1 block w-full rounded border px-2 py-1"
      [ngModel]="search()"
      (ngModelChange)="search.set($event)"
      name="search-{{ state() }}"
      placeholder="site name, city, or county"
    />
  </label>

  <p class="mt-2 text-xs text-slate-600">
    {{ checkedCount() }} of {{ sites().length }} sites selected
  </p>

  <div class="mt-2 max-h-80 overflow-y-auto rounded border border-slate-200">
    @if (sites().length === 0) {
      <p class="p-2 text-sm text-slate-500">Loading sites…</p>
    } @else {
      @for (site of filteredSites(); track site.id) {
        <label class="flex items-start gap-2 border-b border-slate-100 p-2 text-sm last:border-b-0">
          <input
            type="checkbox"
            class="mt-1"
            [checked]="isChecked(site.id)"
            (change)="toggleSite(site.id, $any($event.target).checked)"
          />
          <span>
            <span class="font-medium">{{ site.name }}</span>
            @if (site.city || site.county) {
              <span class="text-slate-600">
                — {{ site.city }}@if (site.city && site.county) {, }{{ site.county }}
              </span>
            }
            @if (site.status === 'deleted') {
              <span class="ml-1 rounded bg-slate-200 px-1 text-xs">delisted</span>
            } @else if (site.status === 'proposed') {
              <span class="ml-1 rounded bg-amber-200 px-1 text-xs">proposed</span>
            }
          </span>
        </label>
      }
    }
  </div>
</fieldset>
```

- [ ] **Step 3: Type-check and lint**

Run: `pnpm tsc --noEmit && pnpm lint`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/app/intake-form/state-residency/
git commit -m "feat: add per-state residency component for Superfund intake"
```

---

## Task 12: Wire state-residency into the intake form

**Files:**
- Modify: `src/app/intake-form/intake-form.component.ts`
- Modify: `src/app/intake-form/intake-form.component.html`

- [ ] **Step 1: Add imports and state to the component**

In `src/app/intake-form/intake-form.component.ts`, add the imports at the top:

```ts
import { StateResidencyComponent } from './state-residency/state-residency.component';
import { SuperfundService, type SuperfundStateInfo } from '../shared/superfund.service';
```

Add `StateResidencyComponent` to the component's `imports: [...]` array.

Inside the component class, add (near other `inject(...)` calls):

```ts
private superfund = inject(SuperfundService);
superfundStates = signal<SuperfundStateInfo[]>([]);

private async loadSuperfundStates() {
  await this.superfund.loadStates();
  this.superfundStates.set(this.superfund.states() ?? []);
}
```

Call `void this.loadSuperfundStates();` from the component's constructor or an `afterNextRender` block. Pattern should match how other async setup in this component is done (`afterNextRender` preferred, since this is zoneless).

Add helper methods:

```ts
private stateName(code: string): string {
  return STATE_NAMES[code] ?? code;
}

toggleState(code: string, checked: boolean): void {
  const env = this.form().environmental;
  const current = env.livedInStates;
  if (checked && !current.some((s) => s.state === code)) {
    this.updateEnv({
      livedInStates: [...current, { state: code, livedYears: null, nearSiteIds: [] }],
    });
  } else if (!checked) {
    this.updateEnv({ livedInStates: current.filter((s) => s.state !== code) });
  }
}

removeState(code: string): void {
  const env = this.form().environmental;
  this.updateEnv({
    livedInStates: env.livedInStates.filter((s) => s.state !== code),
  });
}

updateStateLivedYears(code: string, years: number | null): void {
  const env = this.form().environmental;
  this.updateEnv({
    livedInStates: env.livedInStates.map((s) =>
      s.state === code ? { ...s, livedYears: years } : s,
    ),
  });
}

updateStateSiteIds(code: string, ids: string[]): void {
  const env = this.form().environmental;
  this.updateEnv({
    livedInStates: env.livedInStates.map((s) =>
      s.state === code ? { ...s, nearSiteIds: ids } : s,
    ),
  });
}

isStateSelected(code: string): boolean {
  return this.form().environmental.livedInStates.some((s) => s.state === code);
}

stateNameFor(code: string): string {
  return this.stateName(code);
}
```

The `updateEnv()` helper should follow whatever pattern the component already uses to update `environmental`. If it doesn't exist, implement it as:

```ts
private updateEnv(patch: Partial<EnvironmentalExposure>): void {
  this.form.update((f) => ({
    ...f,
    environmental: { ...f.environmental, ...patch },
  }));
}
```

Add the full state-code → name map as a module-level constant:

```ts
const STATE_NAMES: Record<string, string> = {
  AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California',
  CO: 'Colorado', CT: 'Connecticut', DE: 'Delaware', DC: 'District of Columbia',
  FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
  IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana',
  ME: 'Maine', MD: 'Maryland', MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota',
  MS: 'Mississippi', MO: 'Missouri', MT: 'Montana', NE: 'Nebraska', NV: 'Nevada',
  NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
  NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon',
  PA: 'Pennsylvania', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota',
  TN: 'Tennessee', TX: 'Texas', UT: 'Utah', VT: 'Vermont', VA: 'Virginia',
  WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming',
  PR: 'Puerto Rico', GU: 'Guam', VI: 'U.S. Virgin Islands',
  AS: 'American Samoa', MP: 'Northern Mariana Islands',
};
```

- [ ] **Step 2: Add the UI block to the environmental step template**

In `src/app/intake-form/intake-form.component.html`, inside the environmental step block (below the existing `superfundProximity` self-report question), append:

```html
<fieldset class="mt-6 border-t border-slate-200 pt-4">
  <legend class="text-base font-semibold">States you've lived in (past or present)</legend>
  <p class="mt-1 text-sm text-slate-600">
    Select any U.S. state or territory where you've lived. You'll then be able to mark
    specific Superfund sites in that state if you lived near any of them.
  </p>

  <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
    @for (s of superfundStates(); track s.state) {
      <label class="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          [checked]="isStateSelected(s.state)"
          (change)="toggleState(s.state, $any($event.target).checked)"
        />
        <span>{{ stateNameFor(s.state) }} <span class="text-xs text-slate-500">({{ s.siteCount }})</span></span>
      </label>
    }
  </div>

  @if (form().environmental.livedInStates.length === 0) {
    <p class="mt-4 text-sm text-slate-500">Select one or more states above to browse Superfund sites.</p>
  }

  <div class="mt-4 space-y-4">
    @for (residency of form().environmental.livedInStates; track residency.state) {
      <app-state-residency
        [state]="residency.state"
        [stateName]="stateNameFor(residency.state)"
        [livedYears]="residency.livedYears"
        [nearSiteIds]="residency.nearSiteIds"
        (livedYearsChange)="updateStateLivedYears(residency.state, $event)"
        (nearSiteIdsChange)="updateStateSiteIds(residency.state, $event)"
        (removed)="removeState(residency.state)"
      />
    }
  </div>
</fieldset>
```

- [ ] **Step 3: Send `livedInStates` in the submission POST body**

Locate the submission POST in the intake form (or wherever `ApiClient.post('/api/submissions', …)` is called). Ensure the request body includes `livedInStates: this.form().environmental.livedInStates`. If the current body is built via `anonymize()` / `IntakePayloadService`, augment the produced payload with the new field before posting.

Exact shape sent to `POST /api/submissions` (merging the existing anonymized payload with the new field):

```ts
const payload = this.intakeService.anonymize(this.intakeService.build(this.form()));
const body = { ...payload, livedInStates: this.form().environmental.livedInStates };
await this.api.post('/api/submissions', body);
```

(Adjust to match the exact method names in this component.)

- [ ] **Step 4: Dev build + manual smoke**

Run: `pnpm dev`
Open `http://localhost:4200`, log in as a patient, start an intake, navigate to the environmental step. Expected:
1. The "States you've lived in" section renders with a checkbox grid.
2. Selecting "Florida" opens a per-state panel showing FL sites with a working search filter.
3. Checking some sites and submitting the intake succeeds (201 response).
4. Viewing the resulting submission (as root or researcher with a grant) shows the new "Historical residency near Superfund sites" and "Current residence — Superfund sites within 10 miles" blocks in the rendered markdown.

- [ ] **Step 5: Lint**

Run: `pnpm lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/intake-form/
git commit -m "feat: add state-by-state Superfund residency picker to intake"
```

---

## Task 13: Final verification

**Files:** none (verification only).

- [ ] **Step 1: Run all tests**

Run: `pnpm vitest run`
Expected: all test files (including the four `superfund-*.spec.ts` files) pass.

- [ ] **Step 2: Full production build**

Run: `pnpm run build`
Expected: no errors; `dist/pluma-parkinsons-intake/` produced.

- [ ] **Step 3: Lint clean**

Run: `pnpm lint`
Expected: zero errors, zero warnings.

- [ ] **Step 4: Boot-time auto-seed smoke test (fresh DB)**

This is optional but confirms the auto-seed path. In a throwaway working copy, delete `dev.db`, run `pnpm prisma migrate dev` to rebuild the schema, then `pnpm dev` and watch the logs.
Expected: `[superfund] auto-seeding (sites=0, zips=0)` followed by the summary lines.

- [ ] **Step 5: Verify the CLAUDE.md update need (skip or do)**

Scan `CLAUDE.md` to see if any of the newly-added rules deserve mention (e.g. "public reference-data endpoints skip audit and are auth-gated"). If so, make a small edit. Otherwise skip.

- [ ] **Step 6: Final commit if any adjustments made**

If Step 5 added anything, commit:

```bash
git add CLAUDE.md
git commit -m "docs: note Superfund reference-data endpoints in CLAUDE.md"
```

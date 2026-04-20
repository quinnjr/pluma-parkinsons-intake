import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
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
  state: string | null; // NOTE: nullable — matches Prisma schema, empty CSV value → null
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
  return records.map((r) => {
    const stateRaw = emptyToNull(r['STATE_USPS']);
    return {
      zipCode: r['ZCTA5'].padStart(5, '0'),
      latitude: parseNumber(r['LAT'], 'latitude'),
      longitude: parseNumber(r['LNG'], 'longitude'),
      state: stateRaw ? stateRaw.toUpperCase() : null,
    };
  });
}

interface SeedSummary {
  inserted: number;
  updated: number;
  orphans: number;
}

async function upsertSuperfundSites(
  prisma: PrismaClient,
  rows: SuperfundRow[],
): Promise<SeedSummary> {
  const existingSites = await prisma.superfundSite.findMany({ select: { epaId: true } });
  const existingIds = new Set(existingSites.map((s) => s.epaId));
  const rowIds = new Set(rows.map((r) => r.epaId));

  // Fresh DB: single createMany is dramatically faster than per-row upserts.
  if (existingIds.size === 0) {
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await prisma.superfundSite.createMany({
        data: rows.slice(i, i + chunkSize),
        skipDuplicates: true,
      });
    }
    return { inserted: rows.length, updated: 0, orphans: 0 };
  }

  // Re-seed: real upsert path, batched in transactions to amortize fsync cost.
  let inserted = 0;
  let updated = 0;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.superfundSite.upsert({
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
        }),
      ),
    );
    for (const row of chunk) {
      if (existingIds.has(row.epaId)) updated++;
      else inserted++;
    }
  }

  const orphans = [...existingIds].filter((id) => !rowIds.has(id)).length;
  return { inserted, updated, orphans };
}

async function upsertZipCentroids(
  prisma: PrismaClient,
  rows: ZipCentroidRow[],
): Promise<SeedSummary> {
  const existingZips = await prisma.zipCentroid.findMany({ select: { zipCode: true } });
  const existingIds = new Set(existingZips.map((z) => z.zipCode));

  // Fresh DB: single createMany is ~100x faster than 33k upserts on cold WAL SQLite.
  if (existingIds.size === 0) {
    const chunkSize = 1000;
    for (let i = 0; i < rows.length; i += chunkSize) {
      await prisma.zipCentroid.createMany({
        data: rows.slice(i, i + chunkSize),
        skipDuplicates: true,
      });
    }
    return { inserted: rows.length, updated: 0, orphans: 0 };
  }

  // Re-seed: real upsert path, batched in transactions to amortize fsync cost.
  let inserted = 0;
  let updated = 0;
  const chunkSize = 200;
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await prisma.$transaction(
      chunk.map((row) =>
        prisma.zipCentroid.upsert({
          where: { zipCode: row.zipCode },
          update: { latitude: row.latitude, longitude: row.longitude, state: row.state },
          create: row,
        }),
      ),
    );
    for (const row of chunk) {
      if (existingIds.has(row.zipCode)) updated++;
      else inserted++;
    }
  }

  const rowIds = new Set(rows.map((r) => r.zipCode));
  const orphans = [...existingIds].filter((id) => !rowIds.has(id)).length;
  return { inserted, updated, orphans };
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

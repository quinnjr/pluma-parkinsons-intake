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
    .toSorted((a, b) => a.distanceMiles - b.distanceMiles);

  return within;
}

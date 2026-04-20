import type { PrismaClient, SuperfundSite } from '../prisma/client.js';

const EARTH_RADIUS_MILES = 3958.7613;
export const PROXIMITY_MILES = 10;
const BBOX_SLACK_MILES = 5;

export type NearbySite = Pick<
  SuperfundSite,
  'id' | 'epaId' | 'name' | 'city' | 'county' | 'state' | 'status' | 'contaminants'
> & { distanceMiles: number };

export interface NearbyResult {
  found: boolean;
  sites: NearbySite[];
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

export function bboxBounds(lat: number, radiusMiles: number) {
  const latDelta = radiusMiles / 69;
  // cos(lat)→0 at the poles would make lngDelta infinite; clamp ≈ lat 89.43°.
  const cosLat = Math.max(Math.cos((lat * Math.PI) / 180), 0.01);
  const lngDelta = radiusMiles / (69 * cosLat);
  return { latDelta, lngDelta };
}

export async function nearbySites(
  prisma: PrismaClient,
  zipCode: string,
  radiusMiles: number = PROXIMITY_MILES,
): Promise<NearbyResult> {
  const centroid = await prisma.zipCentroid.findUnique({ where: { zipCode } });
  if (!centroid) return { found: false, sites: [] };

  const { latDelta, lngDelta } = bboxBounds(centroid.latitude, radiusMiles + BBOX_SLACK_MILES);
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

  const sites = candidates
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
    .filter((s) => s.distanceMiles <= radiusMiles);
  sites.sort((a, b) => a.distanceMiles - b.distanceMiles);

  return { found: true, sites };
}

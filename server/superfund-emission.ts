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
    const header =
      s.livedYears == null
        ? `- **${s.stateName}**`
        : `- **${s.stateName}** (~${s.livedYears} years)`;
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

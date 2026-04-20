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

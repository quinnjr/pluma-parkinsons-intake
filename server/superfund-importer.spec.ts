import { describe, it, expect } from 'vitest';
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

  it('maps blank STATE_USPS to null (territorial ZCTAs)', () => {
    const csv = ['ZCTA5,LAT,LNG,STATE_USPS', '00601,18.18,-66.75,'].join('\n');
    const rows = parseZipCentroidCsv(csv);
    expect(rows[0].state).toBeNull();
  });
});

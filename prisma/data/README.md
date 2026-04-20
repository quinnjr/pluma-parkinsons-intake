# Reference data snapshots

Both files here are static, public-domain reference data.

## superfund-sites.csv

Source: EPA National Priorities List (Final + Proposed + Deleted), fetched from the
EPA Envirofacts REST API against the `ENVIROFACTS_SITE` table.

Landing page: https://www.epa.gov/superfund/national-priorities-list-npl-sites-state
API endpoints used (one per NPL status code):

- Final:    https://data.epa.gov/efservice/ENVIROFACTS_SITE/NPL_STATUS_CODE/F/CSV
- Proposed: https://data.epa.gov/efservice/ENVIROFACTS_SITE/NPL_STATUS_CODE/P/CSV
- Deleted:  https://data.epa.gov/efservice/ENVIROFACTS_SITE/NPL_STATUS_CODE/D/CSV

Columns: `EPA_ID, SITE_NAME, CITY, COUNTY, STATE, ZIP_CODE, LATITUDE, LONGITUDE,
STATUS, LISTED_DATE, DELETED_DATE, CONTAMINANTS, EPA_URL`

Notes on column mapping:

- `STATUS` is a human-readable label (`Final` | `Proposed` | `Deleted`), derived
  from the Envirofacts `npl_status_code` (`F`/`P`/`D`).
- `LISTED_DATE` is `non_npl_status_date` for Final + Proposed rows (the date the
  site was proposed or listed). For `Deleted` rows it is left blank and the
  `non_npl_status_date` is surfaced as `DELETED_DATE` instead.
- `CONTAMINANTS` is intentionally blank; the `ENVIROFACTS_SITE` table does not
  carry contaminant detail. A future refresh can backfill this from the SEMS
  contaminants table.
- `EPA_URL` is built deterministically from the EPA ID and points at Cleanups
  In My Community / SEMS: `https://cumulis.epa.gov/supercpad/cursites/csitinfo.cfm?id=<EPA_ID>`.
- `LATITUDE` / `LONGITUDE` may be blank for a small number of sites where EPA
  has no published primary coordinate (importer should tolerate NULLs).

Refresh procedure:

1. Re-download the three CSVs listed above (one per NPL status code).
2. Run the merge script that built this snapshot (see commit history for
   `feat: add csv-parse dep and EPA/Census reference data snapshots`); the
   transformation is deterministic from the raw Envirofacts responses.
3. Replace this file; run `pnpm superfund:seed`.

## zip-centroids.csv

Sources (merged at build time):

1. U.S. Census Bureau 2020 ZCTA Gazetteer file (ZCTA5 + interior-point lat/lng):
   https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2020_Gazetteer/2020_Gaz_zcta_national.zip
2. Community USPS ZIP → state crosswalk (state assignment for each ZIP):
   https://github.com/scpike/us-state-county-zip (file: `geo-data.csv`).

   The Census 2020 Gazetteer omits USPS state per ZCTA, so a supplementary
   crosswalk is required. The task spec originally named HUD's USPS ZIP
   Crosswalk (https://www.huduser.gov/portal/datasets/usps_crosswalk.html) as
   an example; HUD requires a free account for downloads, which is not
   reproducible in CI, so the publicly-available scpike dataset is used
   instead. Both derive from USPS canonical data and agree on state for every
   CONUS + AK/HI ZIP spot-checked.

Columns: `ZCTA5, LAT, LNG, STATE_USPS`

Coverage caveats:

- ~1,890 rows have an empty `STATE_USPS` cell. These are ZCTAs in Puerto Rico,
  U.S. Virgin Islands, and other territories (ZCTAs starting with `006`, `007`,
  `008`, `009`, `969`) that are present in the Census Gazetteer but not in the
  scpike 50-states + DC crosswalk. Downstream proximity logic should treat
  `STATE_USPS = ''` as "unknown state" and fall back to lat/lng-only matching.

Refresh procedure:

1. Download the Census Gazetteer zip at the URL above; unzip to a `.txt`.
2. Download the latest scpike `geo-data.csv` (or substitute HUD's crosswalk if
   you have an account).
3. Re-run the merge script in the same commit that introduced this file.
4. Commit the regenerated CSV; run `pnpm superfund:seed`.

# Superfund sites: reference data, intake UI, and submission enrichment

**Status:** design approved, pre-implementation
**Date:** 2026-04-19
**Author:** collaborative (jquinn@lexmata.ai + Claude)

## Summary

Add EPA National Priorities List (NPL) Superfund site reference data to the intake app so that:

1. At submission time, the server auto-computes Superfund sites within 10 miles of the patient's ZIP and appends them to the emitted markdown + sections JSON.
2. During intake, the patient can indicate which U.S. states they've lived in (past or present) and check specific sites in each state they lived near. This historical-residency block is also emitted to the markdown + sections.

The feature is **reference data + context collection only** — consistent with the project's intake-only scope. No scoring, banding, or risk interpretation. The downstream LLM + omics reasoner consumes the names and contaminants of matched sites.

## Data sources

- **NPL sites:** EPA's publicly-downloadable National Priorities List, including Final + Proposed + Deleted. Snapshot committed to `prisma/data/superfund-sites.csv`.
- **ZIP centroids:** U.S. Census Bureau 2020 ZCTA Gazetteer file (public domain). Snapshot committed to `prisma/data/zip-centroids.csv`. ~33k rows, ~1 MB.

Both files are reproducible: the seeder script header documents the upstream URLs and the manual refresh procedure.

## Data model

Two new Prisma models in `prisma/schema.prisma`:

```prisma
model SuperfundSite {
  id            String   @id @default(uuid())
  epaId         String   @unique
  name          String
  city          String?
  county        String?
  state         String
  zipCode       String?
  latitude      Float
  longitude     Float
  status        String   // 'final' | 'proposed' | 'deleted' | 'partial-deletion'
  listedOn      DateTime?
  deletedOn     DateTime?
  contaminants  String?  // comma-separated best-effort list
  epaUrl        String?
  updatedAt     DateTime @updatedAt
  createdAt     DateTime @default(now())

  @@index([state, name])
  @@index([latitude, longitude])
}

model ZipCentroid {
  zipCode   String @id
  latitude  Float
  longitude Float
  state     String
}
```

Both tables are plaintext — public EPA/Census reference data, not PHI.

`contaminants` is a comma-separated string rather than a JSON array for consistency with the existing `WebAuthnCredential.transports` pattern. SQLite (via Prisma) has no native array type.

Migration name: `add_superfund_sites_and_zip_centroids`.

## Seeder and data pipeline

**Script:** `scripts/seed-superfund.ts`, invoked via new `pnpm superfund:seed`.

**Shared logic module:** `server/superfund-importer.ts`, exporting:
- `seedSuperfundIfEmpty(prisma)` — called at boot from `src/server.ts`.
- `seedSuperfundForce(prisma)` — called by the CLI script.

**Behavior:**
- Parses both CSVs via `csv-parse` (new dependency; MIT-licensed, well-maintained).
- Idempotent upsert keyed on `epaId` (SuperfundSite) and `zipCode` (ZipCentroid).
- Rows no longer present in the CSV are **left alone** (not auto-deleted). Prints a summary: `N inserted, M updated, K unchanged, L in DB but not in CSV (left alone)`.
- Wrapped in a Prisma transaction per table, batched in chunks of 500 to avoid SQLite busy-timeouts.
- Exits non-zero on any row-parse failure (fail loud).

**Auto-seed on empty DB:** `src/server.ts` calls `seedSuperfundIfEmpty(prisma)` after Prisma connects. If either table is empty, the seeder runs inline. Log line: `[superfund] auto-seeded N sites, M zip centroids` or `[superfund] tables populated, skipping auto-seed`.

**Refresh workflow:** human downloads a fresh CSV, commits it, runs `pnpm superfund:seed`.

## Server-side API

Two new routes in `server/admin-routes.ts`. Both gated by `requireAuth` (any confirmed user). Neither produces audit rows — this is public EPA reference data, not PHI.

### `GET /api/superfund/states`

Returns the distinct set of states with at least one site, plus site count per state.

Response: `{ ok: true, states: [{ state: 'CA', siteCount: 103 }, ...] }`

Used by the intake UI to render the "states you've lived in" multi-select.

### `GET /api/superfund/sites?state=FL`

Returns all sites in the given state.

- `state` validated via Zod: exactly 2 uppercase letters.
- Invalid input returns the standard `{ ok: false, errors: [...] }` envelope.
- Response: `{ ok: true, sites: [{ id, epaId, name, city, county, zipCode, status, contaminants, epaUrl }] }` ordered by `name`.
- `latitude` / `longitude` intentionally omitted — UI doesn't need them; trimming the payload keeps CA (~100 sites) under 30 KB.

### Proximity computation (not an endpoint)

Runs server-side during `POST /api/submissions`. Logic lives in `server/superfund-proximity.ts`, exported as a pure function:

```ts
nearbySites(prisma, zipCode: string): Promise<NearbySite[]>
```

Algorithm:
1. Look up `ZipCentroid` by `zipCode`. If not found, return `[]`.
2. Bounding-box filter against `SuperfundSite` using the `[latitude, longitude]` index — pull candidates within a ~15 mi lat/lng delta.
3. Apply exact Haversine distance; keep sites within 10 miles.
4. Sort ascending by distance.

Returns `[{ id, epaId, name, distanceMiles, status, contaminants, city, county, state }]`.

Unit-testable in isolation: given a ZIP → expected set of sites with expected distances.

## Client-side data model

Additions to `src/app/risk/risk.model.ts`:

```ts
export interface StateResidency {
  state: string;
  livedYears: number | null;
  nearSiteIds: string[];   // SuperfundSite.id values
}

// added to EnvironmentalExposure:
livedInStates: StateResidency[];
```

`nearSiteIds` uses `SuperfundSite.id` (not `epaId`) so the server can resolve them with a single `findMany({ where: { id: { in: [...] } } })`.

The existing coarse `superfundProximity: 'none' | 'under-1mi' | '1-5mi' | '5-10mi' | 'unknown'` self-report **stays as-is**. It captures the patient's awareness, which is qualitatively different from ZIP-centroid distance, and removing it would churn existing records.

## Intake UI

**Location:** inside the existing `environmental` step in `intake-form.component.ts`, *below* the existing `superfundProximity` self-report. No new wizard step.

**New Angular service:** `src/app/shared/superfund.service.ts`. Wraps `ApiClient` calls with a signal-based cache keyed by state code (avoids refetching on collapse/reopen).

**New Angular component:** `src/app/intake-form/state-residency/state-residency.component.ts`. Owns the per-state panel. Takes `state` as an input signal. Emits `nearSiteIds` and `livedYears` via model signals.

**UI flow within the environmental step:**

1. **Residency heading:** "States you've lived in (past or present)."
2. **Multi-select** — checkbox list of 2-letter codes + full state name + `(n sites)` hint, backed by `GET /api/superfund/states`. Rendered as a `<fieldset>` / `<legend>` to match existing form patterns.
3. **Per-selected-state panel** (one `state-residency` component per selected state):
   - State name header + "remove state" button.
   - Optional year count input: "About how many years total?"
   - Debounced search input (`type="search"`, signal-backed).
   - Filtered checkbox list of that state's sites from `GET /api/superfund/sites?state=XX`. Each row: `<label><input type="checkbox"> Site name — city, county</label>` with a status badge for `deleted` / `proposed`.
   - Checked-count summary: "3 of 87 sites selected."
4. **Empty state:** if no states selected, show guidance text.

**Validation:** no fields required. Historical residency is opt-in context.

**Icons:** add a residency icon from the existing `src/app/icons.ts` set (e.g. `faHouse` / `faMapLocation`); do not import directly from `@fortawesome/*`.

## Markdown emission and submission payload

Both new blocks are emitted **server-side** and appended to the client's environmental section before encryption. Server is authoritative — prevents client/server drift if site data changes between intake and submission.

### Historical residency block

```
### Historical residency near Superfund sites

- **Florida** (~12 years)
  - Helena Chemical Co. — Tampa, Hillsborough (status: final; contaminants: arsenic, lead)
  - Sapp Battery Salvage — Cottondale, Jackson (status: deleted; contaminants: lead, sulfuric acid)
- **North Carolina** (~4 years)
  - ABC One Hour Cleaners — Jacksonville, Onslow (status: final; contaminants: PCE, TCE)
```

If no states selected or no sites checked across all states, the heading is omitted entirely.

### Current-proximity block

```
### Current residence — Superfund sites within 10 miles

- Miami International Airport Area — 2.3 mi away (status: final; contaminants: TCE, vinyl chloride)
- Homestead Air Force Base — 7.8 mi away (status: deleted; contaminants: PCE, benzene)
```

If no sites match, explicitly emit: `No NPL-listed Superfund sites within 10 miles of submitted ZIP.` — so the downstream reasoner can distinguish "we checked and found none" from "we didn't check."

If the submitted ZIP isn't in `ZipCentroid`, emit: `ZIP centroid unavailable; proximity not computed.`

### Structured sections JSON

Added to the sections JSON (encrypted alongside markdown):

```json
{
  "environmental": {
    "superfundProximity": {
      "selfReported": "under-1mi",
      "auto": {
        "zipCode": "33130",
        "zipCentroidFound": true,
        "sitesWithin10Mi": [
          { "epaId": "FLD980602767", "name": "...", "distanceMiles": 2.3,
            "status": "final", "contaminants": "TCE, vinyl chloride" }
        ]
      }
    },
    "superfundHistorical": [
      {
        "state": "FL",
        "livedYears": 12,
        "sites": [
          { "epaId": "FL...", "name": "...", "city": "Tampa",
            "county": "Hillsborough", "status": "final",
            "contaminants": "arsenic, lead" }
        ]
      }
    ]
  }
}
```

### Submission flow change in `POST /api/submissions`

1. Client posts markdown + sections as today, plus the new `livedInStates` payload.
2. Server computes proximity block from submitted ZIP.
3. Server renders historical residency block from `livedInStates[].nearSiteIds` via `findMany` on SuperfundSite.
4. Server appends both fragments to the client's environmental section (markdown) and injects the structured equivalents into the sections JSON.
5. Resulting markdown + sections are encrypted and stored as today.

### Schema version

The client-side `SCHEMA_VERSION` constant in `src/app/risk/risk.service.ts` bumps from `"1.0.0"` to `"1.1.0"`. This value flows through to `Submission.schemaVersion`. Old records with `"1.0.0"` stay readable; the downstream reasoner treats missing sections as "not collected."

## HIPAA and audit

- **SuperfundSite / ZipCentroid rows are not PHI.** Plaintext storage is correct.
- **No new audit actions.** The existing `submission_create` audit row already captures the write. Reference-data lookups (`/api/superfund/states`, `/api/superfund/sites`) are not audited — they're not PHI access and auditing would flood the audit table.
- **The patient's ZIP remains encrypted** (`zipCodeEnc`) as today. Proximity computation happens with the plaintext ZIP only inside the request handler, before re-encryption for storage. The computed nearby-sites list is embedded in `markdownEnc` / `sectionsEnc` (encrypted).
- **Response timing:** proximity computation adds a bounded DB round-trip + small Haversine loop per submission. No per-user data in the `SuperfundSite` query paths, so no enumeration leak.
- **Rate limiting:** existing audit-row-based rate limiting on `POST /api/submissions` still applies. The new reference-data endpoints need no extra rate limiting beyond Express defaults — they return public data and are auth-gated.

## Dependencies added

- `csv-parse` — runtime dependency for CSV parsing in the seeder.

No other new dependencies. The distance math (Haversine) is trivial and written inline; no `geolib` or similar.

## Out of scope (explicit non-goals)

- **Scoring, banding, or risk weights.** The project-scope memory is explicit: intake app does not score. This feature emits names and contaminants; the downstream reasoner interprets them.
- **State-level SEMS / non-NPL sites.** The dataset is NPL (Final + Proposed + Deleted) only. Expanding to full CERCLIS would be a future design.
- **Live EPA API.** The CSV snapshot approach is intentional — offline, reproducible, no external dependency at boot.
- **Delisting cleanup on reimport.** Rows in the DB that are no longer in the CSV are left alone. A future admin tool can handle cleanup if it becomes load-bearing.
- **Address geocoding.** Proximity uses ZIP-centroid only. Accurate to within a few miles, which is more than enough for the downstream use case.
- **Migrating existing submissions.** The new sections only appear on new submissions. Back-filling historical records is not in scope.

## Testing approach

- **Unit tests** for `nearbySites()`: given a fixture ZIP and a small fixture site set, assert the expected sites + distances. Edge cases: ZIP not in table, no sites in bounding box, sites exactly at boundary.
- **Unit tests** for the seeder's CSV parser: malformed rows, quoted fields with commas, blank optional columns.
- **Integration test** for `POST /api/submissions`: submit with a known ZIP that has one nearby site in fixtures, assert the emitted markdown contains the expected site block.
- **Integration test** for `GET /api/superfund/sites?state=XX`: auth required (401 unauthenticated), invalid state (400 with errors envelope), valid state returns ordered list.
- **Smoke test** for auto-seed on boot: fresh DB → boot → count rows in both tables.

## Rollout

Single-pass: migrate schema, commit CSV snapshots, deploy. Because the feature only emits new markdown sections on new submissions, there's no gated rollout or feature flag — it can't break existing records.

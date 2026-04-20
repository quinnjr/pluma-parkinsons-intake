import 'dotenv/config';
import { APP_BASE_HREF } from '@angular/common';
import { CSP_NONCE } from '@angular/core';
import { CommonEngine, isMainModule } from '@angular/ssr/node';
import express from 'express';
import helmet from 'helmet';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { createId } from '@paralleldrive/cuid2';
import bootstrap from './main.server.js';
import { PrismaClient } from './prisma/client.js';
import { validateAndSanitize } from '../server/anonymize.js';
import { cryptoFromEnv } from '../server/crypto.js';
import { adminRouter, makeLoadAuth } from '../server/admin-routes.js';
import { requireRole } from '../server/auth.js';
import { audit } from '../server/audit.js';
import { seedSuperfundIfEmpty } from '../server/superfund-importer.js';
import { nearbySites } from '../server/superfund-proximity.js';
import {
  buildHistoricalMarkdown,
  buildHistoricalSection,
  buildProximityMarkdown,
  buildProximitySection,
  type HistoricalStateEntry,
} from '../server/superfund-emission.js';
import { US_STATE_NAMES } from './app/shared/us-states.js';

const serverDistFolder = path.dirname(fileURLToPath(import.meta.url));
const browserDistFolder = path.resolve(serverDistFolder, '../browser');
const indexHtmlTemplate = readFileSync(
  path.join(serverDistFolder, 'index.server.html'),
  'utf8',
);

const databaseUrl = process.env['DATABASE_URL'] ?? 'file:./dev.db';
const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
const prisma = new PrismaClient({ adapter });

// Kick off async Superfund/ZIP reference-data seeding on boot. Non-blocking —
// the app starts immediately; seeding logs progress. Endpoints that query
// these tables handle the "still seeding" window by returning an empty list.
void seedSuperfundIfEmpty(prisma).catch((err) => {
  console.error('[superfund] auto-seed failed:', err);
});

const crypto = cryptoFromEnv();

const PERMISSIONS_POLICY = [
  'accelerometer=()',
  'ambient-light-sensor=()',
  'autoplay=()',
  'battery=()',
  'camera=()',
  'display-capture=()',
  'document-domain=()',
  'encrypted-media=()',
  'fullscreen=()',
  'gamepad=()',
  'geolocation=()',
  'gyroscope=()',
  'hid=()',
  'idle-detection=()',
  'magnetometer=()',
  'microphone=()',
  'midi=()',
  'payment=()',
  'picture-in-picture=()',
  'publickey-credentials-get=()',
  'screen-wake-lock=()',
  'serial=()',
  'sync-xhr=()',
  'usb=()',
  'web-share=()',
  'xr-spatial-tracking=()',
].join(', ');

const nonceDirective = (_req: unknown, res: unknown) =>
  `'nonce-${(res as express.Response).locals['cspNonce']}'`;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 'loopback');

// § 164.312(e)(1) transmission security. In production, reject any request
// that arrived over plain HTTP (trust proxy has set req.secure correctly).
if (process.env['NODE_ENV'] === 'production') {
  app.use((req, res, next) => {
    if (req.secure) return next();
    const host = req.headers.host;
    if (!host) {
      res.status(400).end();
      return;
    }
    res.redirect(308, `https://${host}${req.originalUrl}`);
  });
}

const commonEngine = new CommonEngine({
  allowedHosts: (process.env['NG_ALLOWED_HOSTS'] ?? 'localhost,127.0.0.1')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean),
});

app.use((_req, res, next) => {
  res.locals['cspNonce'] = randomBytes(16).toString('base64url');
  next();
});

app.use(
  helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", nonceDirective, "'strict-dynamic'"],
        styleSrc: ["'self'", nonceDirective, 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        frameSrc: ["'none'"],
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        baseUri: ["'self'"],
        objectSrc: ["'none'"],
        manifestSrc: ["'self'"],
        workerSrc: ["'self'"],
        mediaSrc: ["'none'"],
        upgradeInsecureRequests: [],
      },
    },
    // Google Fonts woff2 responses don't send CORP, so require-corp would
    // block them. COOP + CORP below still give cross-origin isolation from
    // inbound documents.
    crossOriginEmbedderPolicy: false,
    crossOriginOpenerPolicy: { policy: 'same-origin' },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    strictTransportSecurity: {
      maxAge: 63_072_000,
      includeSubDomains: true,
      preload: true,
    },
    xFrameOptions: { action: 'deny' },
    xContentTypeOptions: true,
    xDnsPrefetchControl: { allow: false },
    xDownloadOptions: true,
    xPermittedCrossDomainPolicies: { permittedPolicies: 'none' },
    originAgentCluster: true,
  }),
);

// Helmet v8 doesn't ship a Permissions-Policy middleware; set it manually.
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
  next();
});

app.use(express.json({ limit: '256kb' }));
// Scoped to /api — static assets and the SSR catch-all don't need JWT verify
// or a DB round-trip on every request.
app.use('/api', makeLoadAuth(prisma));

app.get('/api/health', async (_req, res) => {
  const count = await prisma.submission.count();
  res.json({ ok: true, submissions: count });
});

app.post('/api/submissions', requireRole('patient'), async (req, res) => {
  const result = validateAndSanitize(req.body);
  if (!result.ok) {
    res.status(400).json({ ok: false, errors: result.errors });
    return;
  }
  const s = result.sanitized;

  const allSiteIds = s.livedInStates.flatMap((st) => st.nearSiteIds);
  const [proximity, historicalSiteRows] = await Promise.all([
    s.zipCode ? nearbySites(prisma, s.zipCode.slice(0, 5)) : null,
    allSiteIds.length > 0
      ? prisma.superfundSite.findMany({
          where: { id: { in: allSiteIds } },
          select: {
            id: true, epaId: true, name: true, city: true, county: true,
            status: true, contaminants: true,
          },
        })
      : [],
  ]);

  let proximityMarkdown = '';
  let proximitySection: ReturnType<typeof buildProximitySection> | null = null;
  if (s.zipCode && proximity) {
    const input = {
      zipCode: s.zipCode,
      zipCentroidFound: proximity.found,
      sites: proximity.sites,
    };
    proximityMarkdown = buildProximityMarkdown(input);
    proximitySection = buildProximitySection(input);
  }

  const byId = new Map(historicalSiteRows.map((row) => [row.id, row]));
  const historicalInput: HistoricalStateEntry[] = s.livedInStates.map((st) => ({
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

// Record retrieval is admin-only — see /api/admin/submissions/* in
// server/admin-routes.ts. The lookupCode is a claim token the submitter hands
// to a researcher; it is not a self-service readback capability.
app.use(adminRouter(prisma, crypto));

// Any unmatched /api/* request returns structured JSON instead of falling
// through to the SSR catch-all below (which would serve the Angular index).
app.use('/api', (_req, res) => {
  res.status(404).json({ ok: false, errors: [{ field: 'body', reason: 'not found' }] });
});

app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

app.use((req, res, next) => {
  const { protocol, originalUrl, baseUrl, headers } = req;
  const nonce = res.locals['cspNonce'] as string;
  const document = indexHtmlTemplate.replace(
    '<app-root',
    `<app-root ngCspNonce="${nonce}"`,
  );
  commonEngine
    .render({
      bootstrap,
      document,
      url: `${protocol}://${headers.host}${originalUrl}`,
      publicPath: browserDistFolder,
      providers: [
        { provide: APP_BASE_HREF, useValue: baseUrl },
        { provide: CSP_NONCE, useValue: nonce },
      ],
    })
    .then((html) => res.send(stampNonces(html, nonce)))
    .catch((err) => {
      console.error('[SSR render error]', err);
      next(err);
    });
});

// CSP 'strict-dynamic' in script-src invalidates 'self', so every <script> tag
// — inline OR src'd — must carry a nonce or it gets blocked. Angular stamps
// CSP_NONCE onto the inline tags it renders, but misses the bootstrap
// <script src="main-*.js"> and the <script id="ng-state"> hydration blob.
const SCRIPT_OR_STYLE_NONCE_RE = /<(script|style)\b(?![^>]*\bnonce=)/gi;
function stampNonces(html: string, nonce: string): string {
  return html.replaceAll(SCRIPT_OR_STYLE_NONCE_RE, `<$1 nonce="${nonce}"`);
}

// Last-resort error handler. Without this Express defaults to leaking a stack
// trace in the response body, which would leak internals + potentially PHI.
const lastResortErrorHandler: express.ErrorRequestHandler = (err, req, res, next) => {
  console.error('[unhandled]', req.method, req.originalUrl, err);
  if (res.headersSent) {
    next(err);
    return;
  }
  res.status(500).json({ ok: false, errors: [{ field: 'body', reason: 'internal error' }] });
};
app.use(lastResortErrorHandler);

if (isMainModule(import.meta.url)) {
  const port = Number(process.env['PORT'] ?? 4000);
  app.listen(port, () => {
    console.log(`[pluma] SSR + API listening on http://127.0.0.1:${port}`);
  });
}

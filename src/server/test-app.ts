// Helper that builds a ready-to-use Express app wired with adminRouter +
// makeLoadAuth + JSON body parser + a tail error handler. Paired with the
// createTestDb() Prisma fixture, it lets specs exercise routes end-to-end
// via supertest without standing up the full SSR stack.
import express from 'express';
import type { Express } from 'express';
import { adminRouter, makeLoadAuth } from './admin-routes.js';
import { CryptoService } from './crypto.js';
import type { PrismaClient } from '../prisma/client.js';

export function makeTestApp(prisma: PrismaClient): { app: Express; crypto: CryptoService } {
  const app = express();
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '256kb' }));
  app.use('/api', makeLoadAuth(prisma));
  const crypto = new CryptoService('x'.repeat(32));
  app.use(adminRouter(prisma, crypto));
  app.use('/api', (_req, res) => {
    res.status(404).json({ ok: false, errors: [{ field: 'body', reason: 'not found' }] });
  });
  const tail: express.ErrorRequestHandler = (_err, _req, res, _next) => {
    res.status(500).json({ ok: false, errors: [{ field: 'body', reason: 'internal error' }] });
  };
  app.use(tail);
  return { app, crypto };
}

/** Create a confirmed user + return an auth cookie usable in supertest requests. */
export async function loginAs(
  prisma: PrismaClient,
  opts: { email: string; role: 'root' | 'researcher' | 'patient'; mfaEnabled?: boolean; confirmed?: boolean },
): Promise<{ user: { id: string; email: string; role: string }; cookie: string }> {
  const { hashPassword, signJwt, COOKIE_NAME } = await import('./auth.js');
  const user = await prisma.user.create({
    data: {
      email: opts.email,
      passwordHash: await hashPassword('Correct-Horse-Battery-Staple'),
      role: opts.role,
      confirmed: opts.confirmed ?? true,
      emailVerified: true,
      mfaEnabled: opts.mfaEnabled ?? false,
    },
  });
  const token = await signJwt({
    sub: user.id,
    email: user.email,
    role: opts.role,
    confirmed: opts.confirmed ?? true,
  });
  return {
    user: { id: user.id, email: user.email, role: user.role },
    cookie: `${COOKIE_NAME}=${token}`,
  };
}

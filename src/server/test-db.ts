// Shared Prisma test-DB harness: a per-test-file SQLite fixture populated
// from the committed migration SQL, returning a fully-typed PrismaClient.
// Used by specs that need a real DB (superfund-importer upserts,
// superfund-proximity.nearbySites, admin-routes integration tests).
import { readFileSync, readdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../prisma/client.js';

// Angular's test runner bundles this file, so `import.meta.url` doesn't
// resolve to an on-disk path. The test process is spawned from the repo root,
// so anchor on process.cwd() instead.
const MIGRATIONS_DIR = path.resolve(process.cwd(), 'prisma', 'migrations');

/** Run every migration SQL against a freshly-created SQLite file. */
function applyMigrations(dbPath: string): void {
  const sqlite = new Database(dbPath);
  try {
    const dirs = readdirSync(MIGRATIONS_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
    for (const dir of dirs) {
      const sqlPath = path.join(MIGRATIONS_DIR, dir, 'migration.sql');
      const sql = readFileSync(sqlPath, 'utf8');
      sqlite.exec(sql);
    }
  } finally {
    sqlite.close();
  }
}

export interface TestDb {
  prisma: PrismaClient;
  dispose: () => Promise<void>;
}

/** Build a fresh PrismaClient backed by a temp-file SQLite with all migrations applied. */
export async function createTestDb(): Promise<TestDb> {
  const dir = mkdtempSync(path.join(tmpdir(), 'pluma-test-'));
  const dbPath = path.join(dir, 'test.db');
  applyMigrations(dbPath);
  const adapter = new PrismaBetterSqlite3({ url: `file:${dbPath}` });
  const prisma = new PrismaClient({ adapter });
  return {
    prisma,
    dispose: async () => {
      await prisma.$disconnect();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

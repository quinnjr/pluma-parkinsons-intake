import 'dotenv/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaClient } from '../src/prisma/client.js';
import { seedSuperfundForce } from '../src/server/superfund-importer.js';

async function main() {
  const databaseUrl = process.env['DATABASE_URL'] ?? 'file:./dev.db';
  const adapter = new PrismaBetterSqlite3({ url: databaseUrl });
  const prisma = new PrismaClient({ adapter });
  try {
    await seedSuperfundForce(prisma);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('[seed-superfund] failed:', err);
  process.exit(1);
});

import 'dotenv/config';
import { defineConfig } from 'prisma/config';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

const databaseUrl = process.env['DATABASE_URL'] ?? 'file:./dev.db';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: databaseUrl,
  },
  // Use the same runtime adapter for CLI operations (migrate, studio, db push).
  adapter: async () => new PrismaBetterSqlite3({ url: databaseUrl }),
});

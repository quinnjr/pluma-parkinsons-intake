// Ensures env vars required by server modules are set before any spec
// imports them. Modules like src/server/challenge-token.ts and src/server/crypto.ts
// cache derived secrets on first call, so the value must be stable across tests.
process.env['JWT_SECRET'] ??= 'x'.repeat(64);
process.env['ENCRYPTION_SECRET'] ??= 'x'.repeat(64);

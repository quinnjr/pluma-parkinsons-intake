# CLAUDE.md

Guidance for AI coding assistants working in this repo. The human-facing docs live in `README.md`.

## Stack at a glance

- Angular 21 (standalone, signals, zoneless, `@for`/`@if`) + SSR via `@angular/ssr` + `CommonEngine`.
- Express 5 colocated in `src/server.ts` — same process handles SSR *and* `/api/*`.
- Prisma 7 + SQLite via `@prisma/adapter-better-sqlite3`.
- Auth: argon2id passwords, HS256 JWT (`jose`) in HttpOnly/SameSite=Strict cookie.
- TOTP MFA via `otpauth` + `qrcode`; email verification + password reset via sha256-hashed single-use tokens.
- WebAuthn passkeys via `@simplewebauthn/server` + `@simplewebauthn/browser`.
- Helmet strict CSP (nonce + `'strict-dynamic'`), SRI, HSTS.
- pnpm, ESLint flat config (typescript-eslint + angular-eslint + eslint-plugin-unicorn).

## Layout

Three folder groups are intentional:

- `src/app/shared/` — cross-cutting: `AuthService`, `ApiClient`, `auth.guard`, `submission.model`, `api-errors`, `MfaSettingsComponent`, `PasskeySettingsComponent`, `WebAuthnService`. **Nothing in `admin/` or `patient/` should be imported from the other**; if a type is used by both, it lives in `shared/`.
- `src/app/admin/` — root + researcher UI (login, signup, dashboard, forgot/reset/verify pages).
- `src/app/patient/` — patient UI (signup, dashboard, researchers grant component).
- `server/` — everything server-only: `admin-routes.ts` (all `/api/*`), `auth.ts`, `audit.ts`, `mfa.ts`, `password-reset.ts`, `email-verification.ts`, `anonymize.ts`, `crypto.ts`, `generated/prisma/`.

## Conventions that matter

### Server-side

- **Every error response is `{ ok: false, errors: [{ field, reason }] }`** — no stray `{ error: '…' }`. Use the `errBody(field, reason)` helper in `server/errors.ts` or `issuesToErrors(zodError.issues)`.
- **Every PHI-adjacent endpoint calls `audit(prisma, {...})`** — view, edit, delete, login, signup, MFA state changes, grant/revoke, verify, reset, WebAuthn register/authenticate. Add new actions to the `AuditAction` union in `server/audit.ts`.
- **Ownership checks go in the `where` clause**, not in application code after a `findUnique`. Use `updateManyAndReturn` / `deleteMany` with compound `where: { id, ownerId }` and check `count`/`length` — it's atomic and there's no existence-leak.
- **Rate limits** are stored as audit rows and counted (`recentFailureCount`). Don't add in-memory state — we want it to survive restarts and work across multiple instances.
- **The dummy argon2 hash** in `admin-routes.ts` (`DUMMY_ARGON2_HASH`) must be a *real* parseable Argon2id envelope, otherwise `argon2.verify` throws instantly and the login-timing defense is defeated.
- **Challenge tokens** (MFA, WebAuthn register, WebAuthn authenticate) use `server/challenge-token.ts` — a single `signChallengeToken(audience, payload)` / `verifyChallengeToken(audience, token)` pair. Don't duplicate the jose sign/verify boilerplate.
- **Route param types**: Express 5 types `req.params[k]` as `string | string[]`. Use the `param(req, name)` helper — don't index directly.
- **RBAC middleware**: `requireAuth` (any confirmed user), `requireRole('root')`, `requireRole('root','researcher')` = staff, `requireRole('patient')`. There is no `requireRoot` — it was a dead-code near-duplicate and got deleted; use `requireRole('root')`.
- **Submission scope for staff**: `scopeForStaff(req)` returns the Prisma `where` fragment that gates researcher queries by grants (root gets `{}`). Always spread it into staff-side record queries.
- **Audit IP**: `req.ip` requires `app.set('trust proxy', 'loopback')` at app init. Don't remove it.

### Client-side

- **Always use `ApiClient`** (`shared/api-client.ts`) — never `inject(HttpClient)` in components/services. It unwraps the Promise and centralizes calls.
- **Error display**: catch `unknown`, derive status with `errorStatus(err)`, and show `firstErrorReason(err, fallback)` (both in `shared/api-errors.ts`). No hand-typed `(err as { error?: { error?: string } }).error` unpacking.
- **All in-app navigation uses `routerLink`** — never `<a href="/admin/…">`. External links (github, CDNs) keep plain `href`.
- **Signals everywhere**: components use `signal` / `computed` / `afterNextRender`. RxJS `firstValueFrom` only inside `ApiClient`.
- **Angular template literals** (`template: \`…\``) can't use `String.raw`, and `\d` inside a JS template literal loses the backslash. For regex patterns in attributes like `pattern`, declare the pattern on the class (`readonly sixDigitPattern = String.raw\`\\d{6}\`;`) and bind with `[pattern]="sixDigitPattern"`. Or import `SIX_DIGIT_PATTERN` from `shared/validation.ts`.
- **Icons** come from `shared/icons.ts` / `APP_ICONS`. Components never `import { faX } from '@fortawesome/*'`. The library is pre-registered globally via `provideAppInitializer` so templates can use `<fa-icon icon="arrow-left" />` or `[icon]="icons.X"`.
- **CSP nonces**: the server stamps a per-request nonce on every `<script>`/`<style>` via `stampNonces` in `src/server.ts`. If you add a build step that emits inline tags, make sure they flow through that stamp.
- **WebAuthn ceremony abort**: browser user-cancellations throw `AbortError`. Use the `isBrowserAbort(err)` helper (in login + passkey-settings components) to distinguish real failures from user cancellations.
- **`setAuthenticatedUser(user)`**: after WebAuthn login, the login component calls this `AuthService` method instead of writing `auth.user.set()` directly.

### Database

- Schema is in `prisma/schema.prisma`. Always run migrations with `pnpm prisma migrate dev --name <descriptive_name>`.
- When adding a non-null column on a non-empty table, use `--create-only` and hand-edit the SQL to backfill. Prisma's `migrate reset` is **blocked** by an AI safety rail — you have to ask the human to run it with `PRISMA_USER_CONSENT_FOR_DANGEROUS_AI_ACTION=<their exact message>`.
- Prisma client regenerates automatically on `migrate dev` but NOT on `migrate reset`. If TS errors after a reset, run `pnpm prisma generate`.
- For ciphertext columns (`*Enc`), encrypt on write, decrypt on read via `server/crypto.ts`. Never store plaintext.

### Build / lint / run

- `pnpm run build` → full SSR build.
- `pnpm run dev` → Angular dev server (SSR + API hot reload).
- `pnpm run lint` → must be clean. `eslint --fix` handles most unicorn auto-fixes.
- `pnpm run start` / `node dist/pluma-parkinsons-intake/server/server.mjs` → prod boot. Needs env vars set.
- Don't use `require('argon2')` in test scripts from the Angular context; it's declared as an `externalDependency` so esbuild won't bundle it. Use the built server bundle.

## Don't

- Don't add in-memory rate-limit maps. Use the `AuditLog` table.
- Don't `findUnique + update` when the ownership predicate can live in the `where`. Collapse with `updateManyAndReturn`.
- Don't store raw tokens (reset, verification). Only the sha256 hash of the token goes in the DB.
- Don't log lookup codes, reset tokens, or verification codes anywhere other than the explicit `console.log` in the handler that generates them. Server access logs should stay out of that territory.
- Don't add `console.log` inside request handlers (except the intentional credential-delivery logs). Audit rows are the source of truth for access.
- Don't return stack traces in API responses. The tail error handler in `src/server.ts` must catch everything.
- Don't `import type { Request } from 'express-serve-static-core'` and augment `req.auth` there. The working augmentation lives in `server/express-augmentation.d.ts` — leave that `.d.ts` in place so `@typescript-eslint/no-namespace` doesn't fire on the declaration.
- Don't duplicate the JWT sign/verify boilerplate. Use `server/challenge-token.ts` for all short-lived ceremony tokens (MFA, WebAuthn).
- Don't call `auth.user.set()` directly from components. Use `AuthService.setAuthenticatedUser()` for non-password login paths.

## HIPAA reminders

Many changes to this code have HIPAA implications. Before adding a feature that touches PHI:

1. Does it need an audit entry? (Almost certainly yes.)
2. Does it need a role gate? (Yes, via `requireRole` / guard.)
3. If it reads data, does the ownership predicate belong in the `where`?
4. Does it change response timing in a way that leaks account existence?
5. Are error messages generic enough to avoid enumeration?
6. Is any PII being emitted to logs that isn't already audited?

The README has a full mapping of current controls to `§ 164.312` sections. Respect it.

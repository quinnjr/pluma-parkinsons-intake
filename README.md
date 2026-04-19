# Pluma · Parkinson's Risk Intake

A HIPAA-conscious Angular 21 intake application for environmental, occupational, and early-symptom data associated with Parkinson's disease. Records are encrypted at rest, owned by individual patients, and packaged as LLM-ready markdown prompts for downstream analysis alongside multi-omics data.

This tool **does not** compute a risk score or produce a diagnosis. It collects structured responses, anonymizes them client-side, and hands a short lookup code back to the submitter.

---

## Architecture

```
Browser ──────── Angular 21 (SSR) ──────── Express 5 ──────── SQLite (Prisma 7)
                  │                          │
                  │ CSP nonce + SRI           │ AES-256-GCM at rest
                  │ provideClientHydration    │ argon2id passwords
                  │ zoneless signals          │ JWT sessions (HS256, 8h)
                  │ Tailwind CSS 4            │ TOTP MFA + recovery codes
                  │ FontAwesome 7             │ WebAuthn / passkeys
                  │                          │ Audit log (§ 164.312(b))
```

- **Angular 21** — standalone components, signals, zoneless change detection, `@for`/`@if` control flow, SSR via `@angular/ssr` + `CommonEngine`.
- **Express 5** — colocated in `src/server.ts`. Same process serves the Angular shell, all `/api/*` endpoints, and static assets.
- **Prisma 7 + SQLite** — via `@prisma/adapter-better-sqlite3`. Eight models: `Submission`, `User`, `WebAuthnCredential`, `MfaRecoveryCode`, `EmailVerificationToken`, `PasswordResetToken`, `RecordAccessGrant`, `AuditLog`.
- **Encryption** — AES-256-GCM (scrypt-derived key) on markdown, sections, ZIP, and TOTP secrets. Only ciphertext is stored; decryption happens at read time.
- **Auth** — argon2id password hashes → HS256 JWT in HttpOnly/SameSite=Strict/Secure cookie → optional TOTP MFA with 10 single-use recovery passcodes → optional WebAuthn passkeys (Touch ID, Windows Hello, security keys, cross-device).
- **Security headers** — Helmet strict CSP (nonce + `'strict-dynamic'`), SubResource Integrity (SHA-384), HSTS (2 yr + preload), X-Frame-Options DENY, Permissions-Policy denying all sensor APIs.

---

## Roles & access model

| Role | Signup path | Activation | Can do |
|---|---|---|---|
| **root** | `/admin/signup` with the `ROOT_ADMIN_EMAIL` | Immediate (auto-confirmed + auto-verified) | Everything: manage users, view all submissions, view audit log, generate password-reset links |
| **researcher** | `/admin/signup` | Email-verified → root-confirmed | View & delete submissions **only from patients who have explicitly granted them access** |
| **patient** | `/patient/signup` (or via the `/` intake gate) | Email-verified (auto-confirmed) | Fill out the intake form, edit/delete/download own records, grant/revoke researcher access, enable MFA/passkeys, delete own account (cascades records) |

Anonymous visitors see only the signup/login pages and the intake form's authentication gate.

---

## User flows

### Patient intake (signup-first)

1. Visitor navigates to `/` → sees "Sign up to start your intake" gate.
2. Signs up at `/patient/signup` → redirected to `/admin/verify-email`.
3. Enters the 6-digit email code (logged to stderr; swap for SMTP in prod).
4. After verification, cookie is issued → redirected to `/` → intake form unlocks.
5. Fills out the multi-step form (demographics, environmental, lifestyle, motor, non-motor, narrative).
6. Reviews responses → "Save to secure storage" → receives a **lookup code** (CUID2).
7. Can manage records, grant researcher access, enable MFA/passkeys from `/patient` dashboard.

### Researcher access

1. Signs up at `/admin/signup` → verifies email → waits for root to confirm.
2. Root logs in, navigates to Users tab, clicks Confirm.
3. Each patient independently grants or revokes access from their dashboard ("Who can see your records").
4. Researcher sees only records from patients who have a live grant. Root always has implicit full access.

### Password reset

`/admin/forgot` → server generates a 1-hour token (sha256 hash stored; plaintext logged) → `/admin/reset-password?token=…` → new password. Root can also generate links via `POST /api/admin/users/:id/reset-password-link`.

### MFA (TOTP + recovery + passkeys)

- **Enable**: dashboard → "Enable two-factor" → scan QR → enter code → receive 10 single-use recovery passcodes (shown once; copy/download .txt).
- **Login**: password check → if MFA is on, server returns a 5-min challenge JWT → client prompts for 6-digit TOTP or recovery passcode → session cookie issued.
- **Passkeys**: dashboard → "Add a passkey" → platform/roaming authenticator ceremony. Login page has "Sign in with a passkey" — fully passwordless, no MFA prompt needed (the biometric *is* the second factor).
- **Disable**: requires current TOTP code (prevents a stolen cookie from turning MFA off).

---

## Security & HIPAA posture

### Implemented in code

| HIPAA section | Control | Implementation |
|---|---|---|
| § 164.312(a)(1) | Access control | JWT + per-request DB reload of user state; `requireRole(...)` middleware; `scopeForStaff(req)` gates researcher queries by grants |
| § 164.312(a)(2)(iii) | Automatic logoff | 8h JWT TTL (env-tunable via `JWT_TTL_SECONDS`) |
| § 164.312(b) | Audit controls | Every PHI access writes an `AuditLog` row (actor, IP, user-agent, target, success, metadata). Root views logs at `GET /api/admin/audit-logs` with cursor pagination + filters. |
| § 164.312(e)(1) | Transmission security | Helmet HSTS; production HTTPS redirect middleware; SRI on bundle assets |
| § 164.308(a)(5)(ii)(D) | Login monitoring | 5 failed logins/email/15 min → 429; same rate-limit on email verification + WebAuthn |
| — | MFA | TOTP (RFC 6238) + recovery passcodes + WebAuthn (FIDO2 passkeys) |
| — | Timing-safe auth | Dummy argon2id verify on unknown emails; generic error messages |
| — | Encryption at rest | AES-256-GCM on all PHI columns + TOTP secrets |
| — | Token storage | Only sha256 hashes of reset/verification tokens stored; plaintext never persists |
| — | Account cascade | `onDelete: Cascade` on `Submission.ownerId` and all token/grant tables |

### Requires operator action

- **BAAs** with every vendor touching DB, backups, logs, TLS terminator, email relay.
- **Risk assessment**, workforce security policy, breach-notification plan, emergency-access procedure.
- **Secret management** — `JWT_SECRET` and `ENCRYPTION_SECRET` need Vault / AWS SM / k8s sealed secrets in production (`.env` is dev-only).
- **Email delivery** — password-reset and verification codes currently logged to stderr. Wire SMTP/SES via `server/mailer.ts`.
- **ZIP code** — full 5-digit ZIP is stored encrypted. Under Safe Harbor de-identification you'd truncate to 3 digits; under Expert Determination or a BAA, 5 is acceptable.

---

## Quick start

```bash
# Install
pnpm install

# Apply database migrations
pnpm prisma migrate dev

# Development (Angular SSR + API + HMR)
pnpm run dev

# Production build
pnpm run build
node dist/pluma-parkinsons-intake/server/server.mjs
```

Docker: `docker compose up --build` — see `docker-compose.yml` for volume + hardening defaults (read-only FS, dropped capabilities, `no-new-privileges`, healthcheck on `/api/health`).

### Environment variables

Copy `.env.example` → `.env` and fill in:

| Variable | Required | Default | Notes |
|---|---|---|---|
| `DATABASE_URL` | yes | `file:./dev.db` | SQLite file path. Docker uses `/data/pluma.db`. |
| `ENCRYPTION_SECRET` | yes | — | Min 16 chars. `openssl rand -base64 48`. Rotating invalidates all ciphertext. |
| `JWT_SECRET` | yes | — | Min 32 chars. `openssl rand -base64 48`. Rotating logs everyone out. |
| `ROOT_ADMIN_EMAIL` | yes | — | Email that claims the root account on first signup. |
| `JWT_TTL_SECONDS` | no | `28800` (8h) | Session duration. |
| `WEBAUTHN_RP_ID` | no | `localhost` | Domain for passkey credential scoping. |
| `WEBAUTHN_RP_NAME` | no | `Pluma` | Display name in authenticator prompts. |
| `WEBAUTHN_ORIGIN` | no | `http://localhost:4000` | Comma-separated origins for WebAuthn verification. |
| `NG_ALLOWED_HOSTS` | no | `localhost,127.0.0.1` | Angular SSR hostname allowlist. |
| `PORT` | no | `4000` | HTTP listen port. |

---

## Project layout

```
src/
  app/
    admin/         Login, signup, dashboard, forgot/reset password, verify-email
    patient/       Signup, dashboard, researchers grant UI
    shared/        AuthService, ApiClient, auth.guard, submission.model,
                   api-errors, validation, icons, MfaSettingsComponent,
                   PasskeySettingsComponent, WebAuthnService
    intake-form/   Multi-step intake form
    submission-review/  Post-submit review + save
    risk/          Payload builder + anonymizer
  server.ts        Angular SSR + Express API entry

server/
  admin-routes.ts      All /api/* routes (auth, admin, patient, audit, WebAuthn)
  auth.ts              argon2 + JWT + cookie helpers + RBAC middleware
  audit.ts             Structured audit logging + rate-limit counting
  challenge-token.ts   Generic signed JWT challenge (MFA + WebAuthn)
  webauthn.ts          rpConfig + challenge helpers + parseTransports
  mfa.ts               TOTP via otpauth + QR code generation
  mfa-recovery.ts      Recovery passcode generation + normalization
  password-reset.ts    Reset-token generation
  email-verification.ts  6-digit verification code generation
  one-time-token.ts    Shared sha256 + token factories
  mailer.ts            Email delivery shim (console.log → swap for SMTP)
  errors.ts            errBody + issuesToErrors helpers
  crypto.ts            AES-256-GCM envelope encrypt/decrypt
  anonymize.ts         Zod schemas + PII-key checks
  express-augmentation.d.ts  req.auth type declaration

prisma/
  schema.prisma        8 models, 8 migrations
```

---

## Scripts

| Script | What it does |
|---|---|
| `pnpm run dev` | Angular dev server (SSR + API + HMR) |
| `pnpm run build` | Production SSR build |
| `pnpm run start` | Boot the production server |
| `pnpm run lint` | ESLint (flat config, must be clean) |
| `pnpm run test` | Angular test runner |
| `pnpm prisma migrate dev` | Apply pending migrations |
| `pnpm prisma generate` | Regenerate the Prisma client |
| `pnpm prisma studio` | Visual database browser |

---

## Important

This tool collects self-reported data only. It does not diagnose Parkinson's disease, does not compute a risk score, and does not replace evaluation by a qualified clinician. Its output is meant to be consumed by a downstream analysis model or a human reviewer with access to the patient's omics data.

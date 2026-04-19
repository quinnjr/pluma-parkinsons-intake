# Changelog

All notable changes to this project will be documented in this file. This project adheres to [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-04-19

### Added

- **Terms of Use** (`/terms`) and **Privacy Policy** (`/privacy`) pages emphasizing HIPAA compliance — PHI handling, encryption, audit controls, access model, patient data rights, breach notification, BAA requirements, governing law (State of Florida).
- Footer links to Terms and Privacy on intake form, login, and both signup pages. Signup pages include consent-by-use notice.

### Changed

- Docker base image switched from `node:22-slim` (Debian) to `node:22-alpine`. Native module compilation handled in the build stage; runtime stays minimal Alpine (~120 MB vs ~250 MB).
- Migrated QR code generation from `qrcode` (CommonJS) to `@quinnjr/qrcode-esm` (native ESM + bundled types). Removed `@types/qrcode` dev dependency and the `qrcode` CJS allowlist entry from `angular.json`.

### Fixed

- Removed stale "Nothing you type is transmitted to a server" copy from the intake form footer.

## [0.1.1] — 2026-04-19

### Changed

- Migrated QR code generation from `qrcode` (CommonJS) to `@quinnjr/qrcode-esm` (native ESM + bundled types). Removed `@types/qrcode` dev dependency and the `qrcode` CJS allowlist entry from `angular.json`.

## [0.1.0] — 2026-04-19

### Added

- **Intake form** — multi-step Angular 21 form covering demographics, environmental exposures (Camp Lejeune, dry cleaners, pesticides, Superfund proximity, heavy metals), lifestyle/medical history, motor symptoms (MDS criteria), non-motor symptoms, and free-text narrative.
- **Anonymized submission** — client strips direct PII before POST; server validates via Zod and rejects stray PII keys. AES-256-GCM encryption at rest on markdown, sections, and ZIP code.
- **Lookup codes** — every submission gets a CUID2 lookup code returned to the patient on save. Researchers use this to find specific records.
- **Angular SSR** — `@angular/ssr` with `CommonEngine`, CSP nonce stamping, SRI (SHA-384) on all bundle assets. Express 5 embedded in `src/server.ts`.
- **Helmet security headers** — strict nonce-based CSP + `'strict-dynamic'`, HSTS (2yr + preload), X-Frame-Options DENY, CORP/COOP same-origin, Permissions-Policy denying all sensor/device APIs.
- **RBAC** — three roles (`root`, `researcher`, `patient`). Root manages users and has full data access. Researchers see only records from patients who have granted them access. Patients own their data.
- **RecordAccessGrant** — patients explicitly grant/revoke researchers from a dashboard. Researchers see nothing without a live grant. Root bypasses grants.
- **Admin panel** — `/admin` dashboard for root + researchers: submission list with lookup-code search, per-record detail view with decrypted markdown download, user management (confirm/delete), audit log viewer with cursor pagination and filters.
- **Patient dashboard** — `/patient` dashboard: submission list, per-record view/edit/delete/download, claim-by-lookup-code, researcher grant/revoke UI, MFA settings, passkey settings, danger-zone account deletion (cascades records).
- **Auth: argon2id + JWT** — passwords hashed with argon2id. HS256 JWT in HttpOnly + SameSite=Strict + Secure cookie (8h TTL, env-tunable). Per-request DB reload so revocations take effect immediately.
- **Email verification** — every new signup issues a 6-digit code (sha256-hashed, 30-min TTL, rate-limited to 5 attempts per email per 15 minutes). Login blocked until verified.
- **Password reset** — `/admin/forgot` → 1-hour token (sha256 hash stored) → `/admin/reset-password`. Root can generate links via API. All outstanding tokens for a user are invalidated on use.
- **TOTP MFA** — `otpauth` + `qrcode`. Setup → QR scan → confirm with code → enable. 10 recovery passcodes (sha256-hashed) issued at enrollment. Login challenge uses a short-lived JWT. Disabling requires a current TOTP code.
- **MFA recovery passcodes** — 10 single-use codes (xxxxx-xxxxx format, ambiguous chars removed). Copy/download .txt. Regenerate endpoint requires current TOTP. Atomic mark-as-used prevents race-based double-redeem.
- **WebAuthn / passkeys** — `@simplewebauthn/server` + `@simplewebauthn/browser`. Register passkeys (Touch ID, Windows Hello, security keys, cross-device) from dashboard. "Sign in with a passkey" on login page — fully passwordless, bypasses MFA. Stateless challenge JWTs (no DB state between begin/finish). Signature counter + `lastUsedAt` tracking.
- **Audit logging** — `AuditLog` table captures every PHI-adjacent action: login/fail/lockout, signup, logout, account delete, submission CRUD, user confirm/delete, MFA enable/disable/challenge-fail/recovery-use/regenerate, email verify/fail, grant/revoke, WebAuthn register/remove/authenticate/challenge-fail, password-reset request/complete. Indexed for efficient rate-limit counting.
- **Login rate limiting** — 5 failed attempts per email per 15 minutes → 429. Same rate-limit on email verification and WebAuthn authentication. Counting uses audit rows (no in-memory state; survives restarts).
- **Production hardening** — HTTPS redirect middleware (when `NODE_ENV=production`), last-resort Express error handler (no stack traces in responses), `trust proxy` for correct `req.ip`.
- **Docker** — multi-stage Dockerfile (Node 22 slim, pnpm via corepack, non-root `node` user), `docker-compose.yml` with volume-backed SQLite, `read_only`, `cap_drop: ALL`, `no-new-privileges`, healthcheck.
- **ESLint** — flat config with `@eslint/js`, `typescript-eslint`, `angular-eslint`, `eslint-plugin-unicorn`. Lint-clean.
- **Postman collection** — 4-step smoke test (health → create → reject → round-trip read).
- **Global FontAwesome** — `provideAppInitializer` + `FaIconLibrary.addIcons(…)` at bootstrap. Single `icons.ts` registry.
- **Shared modules** — `ApiClient` (Promise wrapper around `HttpClient`), `AuthService` (signals-based session), `authGuard` (role-gated), `firstErrorReason`/`errorStatus` error helpers, `SIX_DIGIT_PATTERN` constant, `MfaSettingsComponent`, `PasskeySettingsComponent`.
- **Unified error shape** — every server error response is `{ ok: false, errors: [{ field, reason }] }`.

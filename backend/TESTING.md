# Backend tests

## Local email verification

The backend's local delivery adapter is active only when `NODE_ENV=development`.
It writes the verification URL to the backend terminal and never sends through
an external provider. Add these non-secret settings to the gitignored
`backend/.env` for local use (do not replace unrelated database or JWT settings):

```dotenv
NODE_ENV=development
EMAIL_VERIFICATION_URL=http://localhost:4200/verify-email
# Optional; defaults to 86400 seconds (24 hours).
EMAIL_VERIFICATION_TOKEN_TTL_SECONDS=86400
```

The link uses a URL fragment (`#token=...`), which the Angular `/verify-email`
page removes from the address bar before submitting the token. The local adapter
prints the link but not the recipient address. Registration reports the local
delivery mode so the UI tells the user to check the backend terminal. Resend
remains generic and rate-limited (one minute between attempts, at most five in
24 hours); in development, an eligible resend prints a fresh link.

No production email provider is implemented here. Outside development, delivery
requires an explicitly injected provider adapter. If none is configured, the
backend fails closed and registration returns `503`; it does not report delivery
success or print a local verification link.

## Database-free test suite

Run `npm test` from `backend/`. It uses Node.js's built-in `node:test` runner,
so no test framework dependency is required. The database-free suite verifies
Need, Volunteer Application, and Contribution service rules, validators,
authentication and role middleware, controller error forwarding, selected
parameterized SQL contracts, and central error handling. It does not verify
PostgreSQL SQL execution or database constraints for those workflows.

## PostgreSQL integration suite

The integration suite uses the checked-in PostgreSQL schema (migrations 001–005)
and the dedicated `ngo_connect_test` database. It covers the Need API plus authentication,
Individual preferences, NGO profiles, NGO verification submission, document
metadata and private download authorization, admin verification decisions and
resubmission, Volunteer Applications, Contributions/Fulfillment, Smart
Matching, notification event delivery and idempotency, recipient isolation,
read state, pagination, suspended-account access, and notification privileges.
It accepts **only** `TEST_DATABASE_URL` and requires the database name to be
exactly `ngo_connect_test`. It never falls back to `DATABASE_URL` or the
application `.env` database. It also refuses to run if the target name matches
the configured application `DB_NAME`.

Create a dedicated database manually and apply the schema once before running
the suite. No test script creates databases, runs the schema, truncates tables,
or migrates tables. Run these commands from the repository root in a local
PostgreSQL environment, using a PostgreSQL role intended for tests:

```powershell
createdb -h localhost -p 5432 -U <test-role> ngo_connect_test
$env:TEST_DATABASE_URL = 'postgresql://<test-role>:<test-password>@localhost:5432/ngo_connect_test'
psql $env:TEST_DATABASE_URL -v ON_ERROR_STOP=1 -f .\database\schema.sql
Set-Location .\backend
npm run test:integration
Remove-Item Env:TEST_DATABASE_URL
```

Use the literal database name `ngo_connect_test` and substitute only the local
test role and its credentials. Check the connection target before applying the
schema; do not reuse the development database or its connection string. Keep
the URL in the shell environment rather than committing it. If the dedicated
database already exists, do not drop or reset it to rerun tests; inspect and
clean up that test database manually when needed.

If `TEST_DATABASE_URL` is unset, targets any other database name, points to the
configured application database, or lacks the expected schema, the integration
suite fails before making fixture changes. Both integration files use only
`TEST_DATABASE_URL`; neither falls back to `DATABASE_URL`. The expanded suite
checks the full set of public schema tables before running.

The suites insert uniquely named test users, NGOs, causes, skills, needs,
preferences, applications, contributions, verification submissions, and
documents. The platform integration test injects an in-memory private storage
adapter, so integration runs do not write document objects to disk. Cleanup
deletes only generated user IDs, cause IDs, skill IDs, verification document
IDs, and verification submission IDs. Foreign-key cascades remove dependent
records for those fixtures. Append-only `ngo_verification_history` rows are
intentionally retained and are not updated, deleted, or truncated. No unrelated
record is cleaned up. The tests update only their own fixture records when
checking lifecycle behavior.

## NGO verification uploads

The upload endpoint accepts multipart fields `registrationCertificate`
(required), `pan` (optional), `ngoDarpan` (optional), and up to 10
`supportingDocuments`. Each file must be PDF, JPG/JPEG, or PNG, at most 5 MiB.
The backend checks the filename extension, declared MIME type, and file
signature, and records a SHA-256 checksum. PostgreSQL stores metadata and a
private storage reference; it does not store file contents or public URLs.

For local development the filesystem adapter stores private objects outside
the served source tree. Set `PRIVATE_DOCUMENT_STORAGE_PATH` to an absolute,
writeable directory outside any static/public directory before starting the
backend. If unset in development, the adapter uses its private local default.
In production, `PRIVATE_DOCUMENT_STORAGE_PATH` is required; the application
fails safely rather than writing documents to a public location. Do not expose
the directory through Express static middleware, commit it, or place it under
the frontend/public web root. The integration test uses in-memory storage and
does not require a storage provider.

The supported NGO lifecycle is `NOT_SUBMITTED` → `PENDING` → `APPROVED`,
`REJECTED`, or `NEEDS_INFO`. An NGO may resubmit from `NEEDS_INFO` or
`REJECTED`; resubmission supersedes the former current submission and creates a
new `PENDING` submission atomically. Decisions are serialized with row locks;
the NGO status, current submission, and append-only history event commit in one
transaction. Approval requires a current submission with a registration
certificate. Rejection and information requests require a nonblank message.

## Current verification

`npm test` covers the database-free suite. PostgreSQL integration is not
verified until `npm run test:integration` completes against the dedicated test
database. The integration tests validate PostgreSQL transaction and deferred
constraint behavior; unit tests do not.

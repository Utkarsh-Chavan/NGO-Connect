# NGO Connect

NGO Connect is a web application that helps nonprofit organizations publish
community needs and connect with people who want to contribute time, skills,
materials or other support. It provides public discovery, role-based workspaces,
NGO verification, engagement tracking, notifications and Admin oversight.

## Problem statement

Community organizations need a clear way to describe their needs and manage
responses. Individuals need a way to discover opportunities, apply or offer
support, and follow the outcome. NGO Connect brings those workflows together
with visibility, verification and lifecycle controls.

## Project objectives

- Make eligible NGO needs discoverable to guests and signed-in individuals.
- Let NGOs manage needs and review volunteer applications and contributions.
- Verify NGO organizations through a documented review workflow.
- Preserve application, contribution and lifecycle history as needs progress.
- Give administrators tools for verification, moderation, account management
  and database-backed reporting.

## Features currently implemented

- Individual, NGO and Admin registration/login flows with JWT authentication.
- Email verification, local development delivery, and rate-limited resend.
- NGO profiles, verification submissions, private document handling and Admin
  review decisions.
- Public need browsing, filtering, details, cause catalog and Individual
  recommendations.
- Volunteer applications, contributions, material reservations and engagement
  status transitions.
- NGO workspace for needs, responses, verification and lifecycle management.
- Need moderation, reasoned account suspension/reactivation and Admin audit
  history.
- In-app notifications with unread counts, read state and internal navigation.
- Admin dashboard and reports for registrations, verification, need activity,
  applications, contributions and need categories.
- Scheduled deadline expiration with lifecycle history and idempotent notices.

## User roles

| Role | Capabilities |
| --- | --- |
| Guest | Browse and search publicly eligible needs, view public details, register or sign in. |
| Individual | Manage profile and preferences, receive recommendations, apply to volunteer needs, contribute, track responses and notifications. |
| NGO | Manage its organization profile, submit verification documents, create/manage needs, review responses and close needs. Publishing requires NGO approval. |
| Admin | Review NGO verification, manage account suspension, moderate needs and view dashboard/reports. Admin APIs enforce authorization on the backend. |

## Technology stack

Versions below are declared in the checked-in package files; ranges use npm
semver notation.

| Area | Technology |
| --- | --- |
| Frontend | Angular `^21.2.0`, TypeScript `~5.9.2`, Tailwind CSS `^4.3.3`, RxJS `~7.8.0` |
| Backend | Node.js (CommonJS; no supported Node range is declared), Express `^5.2.1`, `pg` `^8.23.0` |
| Authentication | JWT (`jsonwebtoken` `^9.0.3`), bcrypt `^6.0.0` |
| Database | PostgreSQL; the project does not declare a minimum server version |
| Tests | Node built-in `node:test`; Angular CLI test builder with Vitest |

## Architecture and request flow

```text
Browser (Angular) → Express routes → authentication/role/validation middleware
                                  → controllers → services → repositories
                                  → PostgreSQL
```

The Angular app uses standalone components, lazy-loaded routes, workspace
layouts, guards and an HTTP interceptor for authenticated requests. Its
development environment targets `http://localhost:5000/api`; production uses
the same-origin `/api` path.

The Express app mounts API route modules under `/api`. Routes validate input,
authenticate JWTs and enforce roles where required. Controllers delegate to
services, which apply workflow rules and call parameterized PostgreSQL queries
through repositories. The backend starts an expiry worker with the server; the
worker sweeps due needs and PostgreSQL row locks coordinate concurrent
processing.

## Repository structure

```text
backend/
  src/                 Express app, routes, middleware, controllers, services, repositories
  test/                Backend unit and guarded PostgreSQL integration tests
  docs/                OpenAPI and workflow documentation
  .env.example         Local configuration template
database/
  schema.sql           Final schema for a new empty database
  seed.sql             Cause and skill catalog data
  migrations/          Ordered upgrade scripts 001–006 and applicable rollbacks
  MIGRATIONS.md        Fresh-install and existing-database instructions
docs/                  Admin and need lifecycle documentation
frontend/
  src/app/             Angular routes, layouts, pages, shared components and services
  src/environments/    Development and production API base URLs
```

## Database overview

The schema models users and roles, NGO profiles, NGO verification submissions,
documents and history, causes and skills, needs, applications, contributions,
notifications, Admin actions and need lifecycle history. Needs belong to NGOs
and causes; applications and contributions belong to both a need and an
individual. User preference tables join individuals to causes and skills.

Primary keys use UUIDs with `gen_random_uuid()` defaults. `pgcrypto` is required.
Verification and lifecycle histories have append-only protections; runtime
grants restrict them to reading and insertion. Notification updates are limited
to `read_at` for the runtime role. The full role model, grant details and setup
commands are in [database/MIGRATIONS.md](database/MIGRATIONS.md).

## Authentication and authorization

Registration creates unverified accounts; users must verify email before login.
Successful login returns a signed JWT. Authenticated API requests send it as a
Bearer token. Backend middleware verifies the token, checks account suspension
and enforces role access. Frontend route guards improve navigation but do not
replace backend authorization.

Public registration supports Individual and NGO accounts; it does not permit
public Admin registration. For local-only first Admin setup, follow the
controlled procedure in [database/MIGRATIONS.md](database/MIGRATIONS.md).

## NGO registration and verification

An NGO account creates its organization profile, then submits a registration
certificate and optional supporting documents. Administrators can request
information, approve or reject the current submission. Rejection and
information requests require a message. Submitted files are stored through a
private storage adapter; PostgreSQL stores metadata and private references, not
public document URLs. Approval is required before an NGO can publish active
needs.

## Need creation, discovery and engagement lifecycle

NGOs can create draft needs and publish eligible needs after verification.
Guests and individuals can search and filter public needs. Individuals can
submit volunteer applications or contributions supported by the need type.
NGOs manage response decisions and accepted engagements.

Needs use lifecycle states including `DRAFT`, `ACTIVE`,
`PARTIALLY_FULFILLED`, `COMPLETED`, `EXPIRED` and `CLOSED`. Admin moderation
visibility is separate from lifecycle state. Deadline comparison uses the
PostgreSQL clock; the backend worker expires due needs. Closing a need stops new
responses and cancels pending ones with a recorded reason while preserving
accepted/in-progress commitments and history. Material reservations and
fulfillment are checked under database row locks to avoid over-allocation.

See [docs/need-engagement-lifecycle.md](docs/need-engagement-lifecycle.md) for
transition details.

## Notifications and reporting

Workflow events create recipient-scoped in-app notifications in the same
successful business transaction where applicable. Stable event keys prevent
duplicates. The authenticated user can list notifications, view unread count,
mark one read or mark all read.

Admin reports aggregate records in PostgreSQL, including registration trends,
current NGO verification counts, need creation/completion, application and
contribution submissions, and need categories. Completion trends use recorded
completion timestamps; older completed records without trustworthy dates are
reported separately. See [docs/admin-workspace.md](docs/admin-workspace.md).

## Prerequisites

- Node.js and npm versions compatible with Angular 21 and the checked-in lock
  files. This repository does not currently pin a Node.js version.
- PostgreSQL with permission to install/enable `pgcrypto` in the new database.
- Git and the PostgreSQL client tools (`psql`; `createdb` is useful for tests).

Install frontend and backend dependencies separately using their lock files.

## Local development setup

### 1. Create and initialize a database

For a new local installation, use an empty database and follow **Path A** in
[database/MIGRATIONS.md](database/MIGRATIONS.md). It describes the separate DBA,
`ngo_connect_owner` and `ngo_connect_runtime` roles, extension setup, schema
application, and one-time catalog seed. Do not use a database backup as setup
data.

For an existing installation, inspect its migration state and follow **Path B**
in the same guide. Fresh installs use `database/schema.sql`; existing installs
use only missing migrations 001–006 in order. Never apply the final schema over
an existing migrated database or rerun an applied migration.

### 2. Configure the backend

Copy `backend/.env.example` to `backend/.env` and replace placeholders with
local settings. Do not commit `.env`. Required settings include PostgreSQL
connection fields and a unique `JWT_SECRET`. For local verification, set
`NODE_ENV=development` and `EMAIL_VERIFICATION_URL` to
`http://localhost:4200/verify-email`. Generate a unique JWT secret using a
local cryptographic random generator; do not reuse a template or shared value.

The development email adapter prints verification links in the backend
terminal. No external mail provider is configured. See [backend/TESTING.md](backend/TESTING.md)
for email verification and private document storage behavior.

### 3. Start the backend

Windows PowerShell:

```powershell
Set-Location .\backend
npm install
npm start
```

Linux/macOS:

```sh
cd backend
npm install
npm start
```

The backend defaults to `http://localhost:5000`; `GET /api/health` returns a
health response. For file-watching development, use `npm run dev` from
`backend/`.

### 4. Start the frontend

In a second terminal:

```sh
cd frontend
npm install
npm start
```

On Windows PowerShell, use `Set-Location .\frontend` instead of `cd frontend`.
Angular serves the development app at `http://localhost:4200` and uses the
development API URL configured in `src/environments/environment.development.ts`.

## Environment configuration

See [backend/.env.example](backend/.env.example) for variable names and safe
placeholders. Backend configuration includes:

| Variable | Purpose |
| --- | --- |
| `PORT` | Backend listen port; defaults to 5000. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | PostgreSQL connection. Use the runtime role, not the DBA or owner role. |
| `JWT_SECRET` | Secret used to sign and verify JWTs; generate a unique local value. |
| `JWT_EXPIRES_IN` | Optional token lifetime; defaults to one day in the backend. |
| `NODE_ENV` | Set to `development` to enable local verification-link delivery. |
| `EMAIL_VERIFICATION_URL` | Frontend verification URL for local development. |
| `EMAIL_VERIFICATION_TOKEN_TTL_SECONDS` | Optional token lifetime in seconds; defaults to 86400. |
| `PRIVATE_DOCUMENT_STORAGE_PATH` | Optional local absolute path; required in production. |
| `TEST_DATABASE_URL` | Dedicated test database URL required by guarded backend tests; must name `ngo_connect_test`. |

The Angular API URLs are configured in `frontend/src/environments/` and contain
no credentials.

## Testing

### Backend unit tests

From `backend/`, set `TEST_DATABASE_URL` to a PostgreSQL URL whose database name
is exactly `ngo_connect_test`, then run:

```sh
npm test
```

The test bootstrap requires that dedicated test target and refuses other
database names. Most unit tests mock repository access; this suite does not
replace PostgreSQL integration coverage.

### Backend integration tests

Create a separate empty `ngo_connect_test` database, initialize it with
`database/schema.sql`, and configure `TEST_DATABASE_URL` as described in
[backend/TESTING.md](backend/TESTING.md). Then, from `backend/`, run:

```sh
npm run test:integration
```

The integration suites accept only `TEST_DATABASE_URL`, verify the exact
database name and schema, and do not fall back to the application database
settings. They create isolated fixtures in that test database and clean up the
test records they own; they do not create, migrate or reset a database for you.

### Frontend tests and build

From `frontend/`:

```sh
npm test
npm run build
```

## Security considerations

- Keep `.env` files, database backups and private verification documents out of
  source control.
- Use a unique JWT secret and a non-superuser runtime database role.
- Do not run the backend as the database owner or DBA.
- Backend APIs enforce authentication and authorization; client-side guards are
  not security boundaries.
- Verification documents use private storage and authorized retrieval.
- Do not expose the private storage directory through static hosting.
- The local email adapter is development-only. No production mail provider is
  configured.
- Configure an explicit allowed-origin policy before exposing the backend to a
  production network; the current Express app uses the default `cors()` setup.

## Known limitations

- There is no production email delivery provider in this repository.
- Payment processing is not implemented; monetary needs provide external NGO
  contact/support flows where applicable.
- The repository does not pin a Node.js version or provide a containerized
  deployment configuration.
- Local setup requires manually provisioned database roles and a controlled
  first Admin account, as documented in the database guide.

## Contributing

1. Review the existing architecture and the relevant workflow documentation
   before changing a feature.
2. Keep database changes in ordered migrations with a reviewed rollback where
   appropriate; do not apply migrations automatically at application startup.
3. Keep integration tests restricted to the dedicated `ngo_connect_test`
   database. Never point them at a development or production database.
4. Add focused backend and frontend tests for behavior changes and run the
   relevant suites before submitting a change.
5. Do not commit secrets, local environment files, database backups, generated
   build artifacts or private documents.

## License

No license file is currently present in the repository.

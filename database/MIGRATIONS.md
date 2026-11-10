# Database installation and migrations

Choose exactly one database path below. The final `schema.sql` is for a new,
empty database. Migrations `001`–`006` upgrade an existing application database
whose prior schema and migration state have been reviewed. Never apply the
final schema over an existing database, and never run a migration twice.

## Roles and ownership

Use three distinct identities:

- A separately controlled PostgreSQL bootstrap/DBA login creates databases and
  roles and installs `pgcrypto`. It is not used by the backend.
- `ngo_connect_owner` is `NOLOGIN` and owns the application objects. The schema
  file begins with `SET ROLE ngo_connect_owner`; the operator must be allowed
  to assume this role for installation.
- `ngo_connect_runtime` is the backend `LOGIN` role. It owns no application
  objects, is not a member of the owner or DBA role, and cannot create or alter
  application schema objects.

Set a runtime password interactively in `psql` with `\password
ngo_connect_runtime`, or use an approved local secret manager. Do not place a
reusable password in SQL, shell history, source control, or this document. Set
`DB_PASSWORD` in the ignored `backend/.env` through a secure local method.

The application uses UUID primary keys with `gen_random_uuid()` defaults; the
schema has no serial, identity, or sequence-backed columns. It requires the
PostgreSQL `pgcrypto` extension. The bootstrap/DBA login installs the extension
in the target database before running `schema.sql` as the owner role.

Runtime access is granted explicitly by `schema.sql`: reads and only required
inserts/updates/deletes on operational tables; `notifications` permits updates
only to `read_at`; verification, Admin and lifecycle histories permit only
`SELECT` and `INSERT`. `ngo_connect_runtime` must not own these objects or have
inherited privileges from a privileged role. The schema owner and DBA remain
trusted and can alter the protections.

## Path A: fresh local demo database

These commands are examples for PowerShell from the repository root. Replace
`<bootstrap-login>` with the local DBA login and use a new database name such
as `ngo_connect_demo`. They target only that explicitly named demo database;
they do not target `ngo_connect`. Do not paste passwords into command lines.

### 1. Create roles and an empty database (DBA account)

Open an interactive DBA `psql` session connected to an existing maintenance
database, then run:

```sql
CREATE ROLE ngo_connect_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
CREATE ROLE ngo_connect_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
\password ngo_connect_runtime
CREATE DATABASE ngo_connect_demo;
```

The `\password` command prompts without putting the password in SQL history.
Then connect the DBA session to `ngo_connect_demo` and run:

```sql
CREATE EXTENSION IF NOT EXISTS pgcrypto;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CREATE ON SCHEMA public TO ngo_connect_owner;
GRANT ngo_connect_owner TO <bootstrap-login>;
-- Run only if CONNECT was revoked from PUBLIC in this database:
GRANT CONNECT ON DATABASE ngo_connect_demo TO ngo_connect_runtime;
```

The role membership lets the controlled bootstrap login use `SET ROLE` for
installation. Keep this login separately controlled; do not grant the owner
role to `ngo_connect_runtime`. PostgreSQL commonly grants database `CONNECT`
to `PUBLIC` by default. If that privilege was revoked, the DBA must grant
`CONNECT` explicitly as shown above. The DBA (not `schema.sql`) revokes `CREATE`
on `public` from `PUBLIC`; the schema grants runtime `USAGE` only.

### 2. Apply the final schema as the owner role

From the repository root, connect as the bootstrap login which can assume
`ngo_connect_owner`. The schema executes `SET ROLE ngo_connect_owner` itself,
so every table, index, function and trigger is owned by that role. `pgcrypto`
must already have been installed in this database.

```powershell
$env:NGO_CONNECT_DEMO_URL = 'postgresql://<bootstrap-login>@localhost:5432/ngo_connect_demo'
psql $env:NGO_CONNECT_DEMO_URL -v ON_ERROR_STOP=1 -f .\database\schema.sql
```

Use local `.pgpass`, a supported PostgreSQL password prompt, or another
approved local credential method if the bootstrap login requires authentication.
The connection URL above intentionally contains no password.

### 3. Seed the reference catalog once (owner role)

`seed.sql` inserts the cause and skill catalog only. It creates no accounts,
needs, or demo engagements. Run it once; the inserts are not an idempotent
upsert and a second run can fail on unique names.

```powershell
psql $env:NGO_CONNECT_DEMO_URL -v ON_ERROR_STOP=1 -c "SET ROLE ngo_connect_owner" -f .\database\seed.sql
```

### 4. Set runtime credentials and start the application

Copy `backend/.env.example` to the ignored `backend/.env`. Set `DB_HOST`,
`DB_PORT`, `DB_NAME=ngo_connect_demo`, `DB_USER=ngo_connect_runtime`,
`DB_PASSWORD` using the password assigned interactively above, and a unique
`JWT_SECRET` generated locally. For local verification set
`NODE_ENV=development` and `EMAIL_VERIFICATION_URL` to the Angular localhost
verification route. Do not copy the example placeholders literally.

Start the backend from `backend/` with `npm install` then `npm start`. Start the
frontend from `frontend/` with `npm install` then `npm start`. The development
frontend defaults to `http://localhost:5000/api`; the development backend
defaults to port 5000. The local email adapter prints verification links in the
backend terminal and requires no external mail credential.

The owner role has no login password. To execute the seed step and migrations,
the bootstrap login must be able to assume the owner role. A separate runtime
login should be used for the backend.

## First Admin account (local demo only)

Public registration intentionally does not accept the `ADMIN` role. For a local
demo, register an Individual through the application using a unique password
generated and stored in a password manager. Complete email verification using
the link printed by the development backend. Then, as the controlled DBA or
owner operator, promote exactly that verified account by its UUID in an
interactive `psql` session:

```sql
BEGIN;
UPDATE public.users
   SET role = 'ADMIN', updated_at = clock_timestamp()
 WHERE user_id = '<verified-individual-user-uuid>'
   AND role = 'INDIVIDUAL'
   AND email_verified = TRUE
RETURNING user_id, role;
COMMIT;
```

Confirm the returned row identifies exactly the intended account, then sign in
through the normal UI and verify that the Admin dashboard loads. If the update
does not return exactly one row, roll back and investigate. Do not create an
Admin bootstrap endpoint, store an Admin password in SQL, or leave temporary
elevated credentials in the repository. This is a controlled local setup
procedure; use an approved account-provisioning process for any shared or
deployed environment.

## Path B: upgrade an existing database

Do not use this path for a fresh database and do not apply `schema.sql` after
these migrations. Before upgrading, inspect the target connection and the
database's actual schema/migration state. Back up and rehearse against a
disposable copy. This task does not authorize a migration or any change to the
existing `ngo_connect` database.

Migrations run in this order, applying **only** those confirmed missing:

1. `001_email_and_ngo_verification.sql`
2. `002_one_non_rejected_contribution_per_need.sql`
3. `003_ngo_website_url.sql`
4. `004_admin_workspace.sql`
5. `005_in_app_notifications.sql`
6. `006_need_engagement_lifecycle.sql`

Create `ngo_connect_owner` and `ngo_connect_runtime` before migration 004. For
migration 001, the historical script grants verification-history privileges to
`ngo_connect_app`; it does not grant them to `ngo_connect_runtime`. Keep
migration 001 unchanged: create `ngo_connect_app` as a `NOLOGIN` role before
running it, then, after migration 001 succeeds, grant the required privileges
directly to runtime. Do not rely on group membership: runtime is `NOINHERIT`,
so it does not automatically receive privileges granted to `ngo_connect_app`.
Do not grant runtime membership in the owner or DBA role. Migrations 004–006
grant their history/notification permissions directly to `ngo_connect_runtime`.

Apply migrations as the existing application schema owner (or a controlled
DBA that assumes that owner role) so new objects have consistent ownership.
The owner role must be able to create objects in `public`. Supply a reviewed
target URL interactively or through a secure local mechanism; do not store its
credentials here. Example command shape, run once for each migration confirmed
missing:

```powershell
$env:NGO_CONNECT_MIGRATION_URL = 'postgresql://<bootstrap-login>@localhost:5432/<existing-database>'
psql $env:NGO_CONNECT_MIGRATION_URL -v ON_ERROR_STOP=1 -c "SET ROLE ngo_connect_owner" -f .\database\migrations\001_email_and_ngo_verification.sql
psql $env:NGO_CONNECT_MIGRATION_URL -v ON_ERROR_STOP=1 -c "SET ROLE ngo_connect_owner" -c "GRANT SELECT, INSERT ON TABLE public.ngo_verification_history TO ngo_connect_runtime"
```

Repeat with the exact filename for each missing migration in the order above.
Do not rerun an already-applied file. Migration 001 requires `pgcrypto` and the
`ngo_connect_app` role to exist first. The direct runtime grant above must run
after migration 001 and before the application uses that table. Migrations
004–006 require `ngo_connect_runtime` to exist. Migration 001 is forward-only;
rollback scripts for later migrations can remove stored history or lifecycle
data and must be reviewed separately before any use.

## Migration behavior and limits

- Existing users are backfilled as email-verified; their verification timestamp
  stays `NULL` when the historical time is unknown.
- Migration 001 imports each existing NGO's current state as a legacy
  submission/history event without inventing upload documents or submission
  timestamps.
- Migration 002 stops if existing duplicate active contributions violate the
  partial unique index; it does not resolve or delete records.
- Migration 006 treats prior naive deadlines as UTC wall-clock values and does
  not invent historical completion times.
- Schema and migration SQL do not seed users or demo engagement data.
- Private verification documents are stored outside public web content by the
  backend's private storage adapter. The local storage directory is not part of
  the database and should not be committed or exposed by a static server.

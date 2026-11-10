# Admin Workspace

The Admin Workspace uses the existing JWT `ADMIN` role and is available under `/admin`. Its APIs are mounted under `/api/admin` and authenticate and authorize every route on the server.

## Database change

Migration `004_admin_workspace.sql` adds account suspension state, need visibility moderation state, and append-only administrative action records. The paired `004_admin_workspace.down.sql` removes those additions. Apply the migration through the project's controlled deployment process; the application does not run migrations at startup. Do not apply it to the main development or production database without the normal change approval and backup process.

## API surface

- `GET /api/admin/dashboard` — database-backed counts and recent activity.
- `GET /api/admin/analytics` — registration, verification, need, application, contribution, and need-category aggregates.
- `GET /api/admin/ngos/pending` and `/api/admin/ngos/:ngoId/verification` — existing NGO review workflow and secure document retrieval/actions.
- `GET /api/admin/users` and `/api/admin/users/:userId` — searchable user list and detail, without password hashes or authentication tokens.
- `PATCH /api/admin/users/:userId/status` — reasoned suspension/reactivation. An administrator cannot suspend themself or the last active administrator; existing tokens for suspended accounts are rejected.
- `GET /api/admin/needs` and `/api/admin/needs/:needId` — searchable need list and details.
- `PATCH /api/admin/needs/:needId/moderation` — reasoned hide/restore action. Hiding does not delete the need or its application/contribution history; hidden needs are removed from public discovery and new application/contribution eligibility.

Need completion reporting is grouped by creation month and indicates how many needs in that cohort are currently fulfilled. The schema does not record a completion timestamp, so the report does not claim a monthly completion date.

# Need and engagement lifecycle

## Need transition rules

| Current state | Allowed next state | Notes |
| --- | --- | --- |
| DRAFT | ACTIVE, EXPIRED, CLOSED | ACTIVE requires an approved NGO. A deadline reached while still draft is expired on the next lifecycle operation. |
| ACTIVE | PARTIALLY_FULFILLED, COMPLETED, EXPIRED, CLOSED | Material fulfillment updates the state; deadline expiry and NGO closure are system/owner actions. |
| PARTIALLY_FULFILLED | COMPLETED, EXPIRED, CLOSED | Accepted and in-progress material engagements remain reserved. |
| EXPIRED | CLOSED or COMPLETED when existing material commitments finish the need | Expiry stops new submissions. `expired_at` remains as history if a need later reaches COMPLETED. |
| CLOSED | CLOSED; completion metadata may be recorded as existing commitments finish | Closure is terminal for intake and cannot be undone through the NGO edit API. |
| COMPLETED / legacy FULFILLED | terminal | Completed needs cannot be closed or republished. FULFILLED remains readable for old records. |

`moderation_status` is independent (`VISIBLE` / `HIDDEN`). Restoring visibility never changes lifecycle status. Public discovery and submissions require an active/partially fulfilled lifecycle, visible moderation, approved unsuspended NGO, and a future/no deadline.

## Engagement transitions

| Record | Allowed transitions |
| --- | --- |
| Volunteer application | APPLIED → ACCEPTED or REJECTED; ACCEPTED → COMPLETED |
| Contribution | PENDING → ACCEPTED or REJECTED; ACCEPTED → IN_PROGRESS; IN_PROGRESS → COMPLETED |

Closing a need transactionally rejects only pending (`APPLIED` / `PENDING`) records and writes a system reason. Accepted, in-progress, completed, and rejected history remains unchanged. Only accepted/in-progress material contributions reserve quantity. Need-row locks serialize intake, closure, reservation changes, and completion totals; material acceptance/completion rechecks `fulfilled + reserved <= required` under that lock. Contact endpoints retain their existing accepted/completed authorization rules.

## Expiry, time, and history

Migration 006 converts existing timezone-naive deadline values as UTC instants. New deadline inputs require an ISO 8601 timezone (`Z` or explicit offset). Backend comparisons use PostgreSQL `clock_timestamp()`; a deadline equal to the current instant is expired. An idempotent expiry operation runs during public/owner/admin discovery, recommendations, submissions, engagement transitions, and closure. There is no permanent worker requirement. Lifecycle history is append-only and each transition uses a unique event key. Repeated lifecycle operations preserve the first recorded timestamp.

New completions have `completed_at` and lifecycle history. Historical `FULFILLED` rows are not assigned invented dates; reports count them separately as lacking a completion date. Migration rollback refuses while new closed/completed lifecycle states or lifecycle notifications exist. If rollback is forced after external archival, it drops history, lifecycle timestamps, and resolution reasons and converts deadline instants back to UTC wall-clock values.

## API

- `POST /api/ngos/me/needs/{needId}/close` closes an owned need; closure is idempotent and returns canceled pending and preserved engagement counts.
- Existing need listing/detail and engagement APIs keep their response contracts, with lifecycle metadata added to owner and individual history views.

See [OpenAPI](../backend/docs/openapi.yaml) and [migration notes](../database/MIGRATIONS.md).

# Contribution workflow MVP decisions

## Schema facts

- `contributions.contribution_type` is limited to `MATERIAL`, `MONEY`, and
  `SKILL`. A need may also have type `VOLUNTEER`, which is handled through
  volunteer applications instead.
- Contribution rows contain nullable `description` (`TEXT`), `quantity`
  (`INTEGER`, positive when present), and `amount` (`NUMERIC(12,2)`, positive
  when present). The database does not enforce type-specific combinations.
- Contribution status values are `PENDING`, `ACCEPTED`, `IN_PROGRESS`,
  `COMPLETED`, and `REJECTED`; the schema does not define transitions or who
  may perform them.
- Needs use an integer `quantity_required` and `quantity_fulfilled`, without a
  unit. A need may have a null required quantity.
- Seed data contains causes and skills, but no contribution or need examples.

## MVP behavior implemented

- An authenticated `INDIVIDUAL` can create a contribution only for a matching
  `ACTIVE` or `PARTIALLY_FULFILLED` need whose deadline has not passed.
- An individual may have at most one contribution per need in `PENDING`,
  `ACCEPTED`, `IN_PROGRESS`, or `COMPLETED`. A `REJECTED` contribution remains
  in history but does not block resubmission. A partial unique index enforces
  the rule across concurrent requests; conflicts return `409`.
- `MATERIAL` requires a positive integer quantity and disallows amount.
  `MONEY` requires a positive `NUMERIC(12,2)`-compatible amount and disallows
  quantity. `SKILL` accepts a description only because no quantity unit is
  defined. The contribution type must equal the need's type.
- An NGO may list and transition contributions only for needs it owns.
  Transitions are `PENDING` to `ACCEPTED` or `REJECTED`, `ACCEPTED` to
  `IN_PROGRESS`, and `IN_PROGRESS` to `COMPLETED`.
- Completing a `MATERIAL` contribution atomically increments
  `quantity_fulfilled`. If `quantity_required` is set, an over-fulfillment is
  rejected with `409`; reaching the requested quantity marks the need
  `FULFILLED`, and a lower total marks it `PARTIALLY_FULFILLED`. When required
  quantity is null, the total is incremented without an automatic need status
  transition because the schema supplies no completion threshold.
- `MONEY` is recorded as a pledge only. No payment is charged, captured, or
  verified. `MONEY` and `SKILL` completions do not change
  `quantity_fulfilled`.

## Decisions still needed

- Whether skill contributions should count against a need quantity requires a
  unit definition (for example, hours or sessions) and corresponding need
  metadata. Until then skill quantity is rejected and fulfillment is not
  counted.
- Money fulfillment requires a requested amount on a need, which the current
  schema does not have. The contribution amount is therefore not compared to
  `quantity_required`, and payment remains unverified.
- The status progression above is the MVP interpretation of the enum and the
  stated NGO acceptance/rejection requirement. If contributors should mark
  `IN_PROGRESS` or `COMPLETED`, or if an NGO may complete directly from
  `ACCEPTED`, that role/transition policy needs an explicit product decision.

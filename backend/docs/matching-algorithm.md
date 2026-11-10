# Smart Need–Contribution Matching MVP

This endpoint uses a deterministic, rule-based score. It does not use AI or
machine learning.

## Eligibility

The candidate query mirrors the public Need API: a need must have status
`ACTIVE` or `PARTIALLY_FULFILLED`, and its deadline must be null or later than
the query time. Its NGO must currently have `APPROVED` verification status.
Eligibility is checked before scoring; priority never makes a draft, fulfilled,
expired, unapproved, or past-deadline need eligible. Results are scoped to the
authenticated individual and expose only public need fields, NGO/cause names,
score, and reasons.

## Inputs

- Cause preference: `user_causes.cause_id` compared with `needs.cause_id`.
  Only active cause catalog entries count as preference matches.
- Skills: `user_skills.proficiency_level` compared with
  `need_skills.required_level`. Only active skill catalog entries participate.
- Location: exact trimmed, case-insensitive equality between the individual's
  `users.city` and either `ngos.city` or `needs.location`. Substring matching is
  intentionally avoided because `needs.location` may describe a place rather
  than a city.
- Priority: `needs.priority`.

The schema also has JSONB availability fields on users and needs, but their
shape and matching semantics are undefined, so availability is omitted.
Contribution history, donor details, and private user fields are not queried.

## Score

| Factor | Points |
| --- | ---: |
| Cause preference match | 40 |
| Each required skill met or exceeded | 10, capped at 30 |
| Exact city match | 20 |
| URGENT priority | 10 |
| HIGH priority | 7 |
| MEDIUM priority | 4 |
| LOW priority | 1 |

The maximum score is 100. A skill qualifies when the individual's proficiency
rank is at least the need's requested rank (`BEGINNER < INTERMEDIATE < ADVANCED
< EXPERT`). Duplicate required skill rows do not increase score. Reasons are
returned for every awarded factor, including skill names and the compared
levels.

## Ordering and pagination

Recommendations sort by descending score, then newest need creation time, then
ascending need UUID. The service ranks the complete eligible candidate set
before applying `limit` (default 20, maximum 100) and `offset` (default 0).

## Limitations

- City matching uses exact text equality; there is no geocoding or canonical
  location identifier.
- Availability matching is omitted until its JSONB structure and business
  meaning are defined.
- The MVP loads all eligible candidate needs before ranking and pagination.
  Large catalogs may need an optimized ranking query or bounded candidate
  strategy while preserving identical score and ordering behavior.

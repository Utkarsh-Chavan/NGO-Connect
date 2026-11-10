const pool = require("../config/database");

const responseCte = `
  WITH response_entries AS (
    SELECT va.application_id AS response_id, va.need_id, n.title AS need_title,
           n.status AS need_status, n.moderation_status AS need_moderation_status, n.deadline AS need_deadline,
           'APPLICATION'::text AS response_kind, 'VOLUNTEER'::varchar AS contribution_type,
           va.message AS details, va.resolution_reason, NULL::integer AS quantity, NULL::numeric AS amount,
           va.status, va.applied_at AS submitted_at, va.updated_at,
           u.name AS individual_name, u.city AS individual_city
      FROM volunteer_applications va
      JOIN needs n ON n.need_id = va.need_id
      JOIN users u ON u.user_id = va.user_id
     WHERE n.ngo_id = $1
    UNION ALL
    SELECT c.contribution_id, c.need_id, n.title,
           n.status, n.moderation_status, n.deadline,
           'CONTRIBUTION'::text, c.contribution_type,
           c.description, c.resolution_reason, c.quantity, c.amount,
           c.status, c.created_at, c.updated_at,
           u.name, u.city
      FROM contributions c
      JOIN needs n ON n.need_id = c.need_id
      JOIN users u ON u.user_id = c.user_id
     WHERE n.ngo_id = $1
  )
`;

const findOwnedNeeds = async ({ ngoId, limit, offset, status, contributionType, search }) => {
  const result = await pool.query(
    `
      WITH owned AS (
        SELECT n.need_id, n.ngo_id, n.cause_id, n.title, n.description,
               n.contribution_type, n.location, n.availability, n.quantity_required,
               n.quantity_fulfilled,
               COALESCE((SELECT SUM(r.quantity) FROM contributions r
                          WHERE r.need_id = n.need_id AND r.contribution_type = 'MATERIAL'
                            AND r.status IN ('ACCEPTED', 'IN_PROGRESS')), 0)::bigint AS quantity_reserved,
               CASE WHEN n.quantity_required IS NULL THEN NULL
                    ELSE GREATEST(n.quantity_required - n.quantity_fulfilled -
                      COALESCE((SELECT SUM(r.quantity) FROM contributions r
                                 WHERE r.need_id = n.need_id AND r.contribution_type = 'MATERIAL'
                                   AND r.status IN ('ACCEPTED', 'IN_PROGRESS')), 0), 0)::bigint
               END AS quantity_available,
               n.priority, n.deadline, n.status, n.completed_at, n.closed_at, n.expired_at,
               (SELECT COUNT(*)::int FROM volunteer_applications a WHERE a.need_id = n.need_id AND a.status = 'ACCEPTED') AS accepted_application_count,
               (SELECT COUNT(*)::int FROM contributions x WHERE x.need_id = n.need_id AND x.status = 'ACCEPTED') AS accepted_contribution_count,
               (SELECT COUNT(*)::int FROM contributions x WHERE x.need_id = n.need_id AND x.status = 'IN_PROGRESS') AS in_progress_contribution_count,
               n.created_at, n.updated_at,
               g.name AS ngo_name, c.name AS cause_name
          FROM needs n
          JOIN ngos g ON g.ngo_id = n.ngo_id
          JOIN causes c ON c.cause_id = n.cause_id
         WHERE n.ngo_id = $1
           AND ($2::varchar IS NULL OR n.status = $2::varchar)
           AND ($3::varchar IS NULL OR n.contribution_type = $3::varchar)
           AND ($4::varchar IS NULL OR n.title ILIKE '%' || $4 || '%')
      ), page AS (
        SELECT * FROM owned ORDER BY created_at DESC, need_id LIMIT $5 OFFSET $6
      )
      SELECT (SELECT COUNT(*)::int FROM owned) AS total,
             COALESCE((SELECT json_agg(to_jsonb(page) ORDER BY page.created_at DESC, page.need_id) FROM page), '[]'::json) AS items
    `,
    [ngoId, status || null, contributionType || null, search || null, limit, offset]
  );
  return result.rows[0];
};

const findResponses = async ({ ngoId, limit, offset, status, contributionType, needId, search }) => {
  const values = [ngoId, status || null, contributionType || null, needId || null, search || null, limit, offset];
  const result = await pool.query(
    `${responseCte}, filtered AS (
       SELECT * FROM response_entries
        WHERE ($2::varchar IS NULL OR status = $2::varchar)
          AND ($3::varchar IS NULL OR contribution_type = $3::varchar)
          AND ($4::uuid IS NULL OR need_id = $4::uuid)
          AND ($5::varchar IS NULL OR need_title ILIKE '%' || $5 || '%' OR individual_name ILIKE '%' || $5 || '%')
     ), page AS (
       SELECT * FROM filtered ORDER BY submitted_at DESC, response_id LIMIT $6 OFFSET $7
     )
     SELECT (SELECT COUNT(*)::int FROM filtered) AS total,
            COALESCE((SELECT json_agg(to_jsonb(page) ORDER BY page.submitted_at DESC, page.response_id) FROM page), '[]'::json) AS items`,
    values
  );
  return result.rows[0];
};

const findDashboard = async (ngoId) => {
  const result = await pool.query(
    `${responseCte}, need_counts AS (
       SELECT COUNT(*) FILTER (WHERE status IN ('ACTIVE', 'PARTIALLY_FULFILLED'))::int AS active_needs,
              COUNT(*) FILTER (WHERE status = 'DRAFT')::int AS draft_needs,
              COUNT(*) FILTER (WHERE status IN ('COMPLETED', 'FULFILLED'))::int AS completed_needs,
              COUNT(*) FILTER (WHERE status = 'CLOSED')::int AS closed_needs,
              COUNT(*) FILTER (WHERE status = 'EXPIRED')::int AS expired_needs
         FROM needs WHERE ngo_id = $1
     ), response_counts AS (
       SELECT COUNT(*) FILTER (WHERE status IN ('APPLIED', 'PENDING'))::int AS pending_responses,
              COUNT(*)::int AS total_responses
         FROM response_entries
     ), recent AS (
       SELECT COALESCE(json_agg(to_jsonb(page) ORDER BY page.updated_at DESC, page.response_id), '[]'::json) AS items
         FROM (SELECT response_id, need_id, need_title, response_kind, contribution_type,
                      status, submitted_at, updated_at, individual_name
                 FROM response_entries
                ORDER BY updated_at DESC, response_id LIMIT 8) page
     )
     SELECT need_counts.*, response_counts.*, recent.items AS recent_activity
       FROM need_counts CROSS JOIN response_counts CROSS JOIN recent`,
    [ngoId]
  );
  return result.rows[0];
};

module.exports = { findOwnedNeeds, findResponses, findDashboard };

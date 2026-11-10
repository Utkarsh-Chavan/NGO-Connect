const pool = require("../config/database");

const findIndividualDashboard = async (userId) => {
  const result = await pool.query(
    `
      WITH engagements AS (
        SELECT va.application_id AS engagement_id, va.need_id, n.title AS need_title,
               n.status AS need_status, n.deadline AS need_deadline,
               va.resolution_reason,
               g.name AS ngo_name, 'VOLUNTEER_APPLICATION'::text AS engagement_type,
               'VOLUNTEER'::text AS contribution_type, va.status, va.applied_at AS submitted_at
        FROM volunteer_applications va
        JOIN needs n ON n.need_id = va.need_id
        JOIN ngos g ON g.ngo_id = n.ngo_id
        WHERE va.user_id = $1
        UNION ALL
        SELECT c.contribution_id, c.need_id, n.title,
               n.status, n.deadline, c.resolution_reason,
               g.name, 'CONTRIBUTION'::text,
               c.contribution_type, c.status, c.created_at
        FROM contributions c
        JOIN needs n ON n.need_id = c.need_id
        JOIN ngos g ON g.ngo_id = n.ngo_id
        WHERE c.user_id = $1
      ),
      counts AS (
        SELECT
          COUNT(*) FILTER (WHERE status IN ('APPLIED', 'PENDING'))::int AS pending,
          COUNT(*) FILTER (WHERE status = 'ACCEPTED')::int AS accepted,
          COUNT(*) FILTER (WHERE status = 'IN_PROGRESS')::int AS in_progress,
          COUNT(*) FILTER (WHERE status = 'COMPLETED')::int AS completed,
          COUNT(*) FILTER (WHERE engagement_type = 'VOLUNTEER_APPLICATION' AND status IN ('APPLIED', 'PENDING'))::int AS pending_applications,
          COUNT(*) FILTER (WHERE engagement_type = 'CONTRIBUTION' AND status = 'PENDING')::int AS pending_contributions,
          COUNT(*) FILTER (WHERE engagement_type = 'VOLUNTEER_APPLICATION' AND status = 'ACCEPTED')::int AS accepted_applications,
          COUNT(*) FILTER (WHERE engagement_type = 'CONTRIBUTION' AND status = 'ACCEPTED')::int AS accepted_contributions,
          COUNT(*) FILTER (WHERE engagement_type = 'CONTRIBUTION' AND status = 'IN_PROGRESS')::int AS in_progress_contributions,
          COUNT(*) FILTER (WHERE engagement_type = 'VOLUNTEER_APPLICATION' AND status = 'COMPLETED')::int AS completed_applications,
          COUNT(*) FILTER (WHERE engagement_type = 'CONTRIBUTION' AND status = 'COMPLETED')::int AS completed_contributions
        FROM engagements
      ),
      recent AS (
        SELECT COALESCE(json_agg(row_to_json(items) ORDER BY submitted_at DESC, engagement_id), '[]'::json) AS activity
        FROM (SELECT * FROM engagements ORDER BY submitted_at DESC, engagement_id LIMIT 8) items
      )
      SELECT counts.pending, counts.accepted, counts.in_progress, counts.completed,
             counts.pending_applications, counts.pending_contributions,
             counts.accepted_applications, counts.accepted_contributions,
             counts.in_progress_contributions, counts.completed_applications,
             counts.completed_contributions,
             recent.activity AS recent_activity
      FROM counts CROSS JOIN recent
    `,
    [userId]
  );
  return result.rows[0];
};

module.exports = { findIndividualDashboard };

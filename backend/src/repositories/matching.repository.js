const pool = require("../config/database");

const findEligibleNeedsForUser = async (userId) => {
  const result = await pool.query(
    `
      SELECT
        n.need_id, n.cause_id, n.title, n.description, n.contribution_type,
        n.location, n.availability, n.quantity_required, n.quantity_fulfilled,
        n.priority, n.deadline, n.status, n.created_at, n.updated_at,
        g.name AS ngo_name, g.city AS ngo_city, c.name AS cause_name,
        viewer.city AS user_city,
        EXISTS (
          SELECT 1
          FROM user_causes uc
          JOIN causes preferred_cause
            ON preferred_cause.cause_id = uc.cause_id
           AND preferred_cause.is_active = TRUE
          WHERE uc.user_id = viewer.user_id
            AND uc.cause_id = n.cause_id
        ) AS cause_preference_match,
        ns.skill_id AS required_skill_id,
        required_skill.name AS required_skill_name,
        ns.required_level,
        user_skill.proficiency_level AS user_proficiency_level
      FROM needs n
      JOIN ngos g ON g.ngo_id = n.ngo_id
      JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
      JOIN causes c ON c.cause_id = n.cause_id
      JOIN users viewer ON viewer.user_id = $1 AND viewer.role = 'INDIVIDUAL'
      LEFT JOIN need_skills ns ON ns.need_id = n.need_id
      LEFT JOIN skills required_skill
        ON required_skill.skill_id = ns.skill_id
       AND required_skill.is_active = TRUE
      LEFT JOIN user_skills user_skill
        ON user_skill.user_id = viewer.user_id
       AND user_skill.skill_id = required_skill.skill_id
      WHERE n.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
        AND n.moderation_status = 'VISIBLE'
        AND g.verification_status = 'APPROVED'
        AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
      ORDER BY n.created_at DESC, n.need_id ASC, required_skill.name ASC, ns.skill_id ASC
    `,
    [userId]
  );

  return result.rows;
};

module.exports = { findEligibleNeedsForUser };

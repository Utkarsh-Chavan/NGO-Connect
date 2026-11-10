const pool = require("../config/database");

const findApplicationContactContext = async (applicationId) => {
  const result = await pool.query(
    `
      SELECT va.status, va.user_id AS individual_user_id,
             applicant.name AS individual_name,
             applicant.email AS individual_email,
             applicant.phone AS individual_phone,
             ngo.user_id AS ngo_user_id, ngo.name AS ngo_name,
             ngo.email AS ngo_email, ngo.phone AS ngo_phone
      FROM volunteer_applications va
      JOIN needs n ON n.need_id = va.need_id
      JOIN ngos ngo ON ngo.ngo_id = n.ngo_id
      JOIN users applicant ON applicant.user_id = va.user_id
      WHERE va.application_id = $1
    `,
    [applicationId]
  );
  return result.rows[0] || null;
};

const findContributionContactContext = async (contributionId) => {
  const result = await pool.query(
    `
      SELECT c.status, c.contribution_type, c.user_id AS individual_user_id,
             contributor.name AS individual_name,
             contributor.email AS individual_email,
             contributor.phone AS individual_phone,
             ngo.user_id AS ngo_user_id, ngo.name AS ngo_name,
             ngo.email AS ngo_email, ngo.phone AS ngo_phone
      FROM contributions c
      JOIN needs n ON n.need_id = c.need_id
      JOIN ngos ngo ON ngo.ngo_id = n.ngo_id
      JOIN users contributor ON contributor.user_id = c.user_id
      WHERE c.contribution_id = $1
    `,
    [contributionId]
  );
  return result.rows[0] || null;
};

module.exports = { findApplicationContactContext, findContributionContactContext };

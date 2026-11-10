const pool = require("../config/database");
const transactionRepository = require("./transaction.repository");
const notificationEvents = require("./notificationEvents.repository");
const needLifecycleRepository = require("./needLifecycle.repository");

const findNeedContributionType = async (needId) => {
  const result = await pool.query(
    `
      SELECT n.contribution_type
      FROM needs n
      JOIN ngos g ON g.ngo_id = n.ngo_id
      JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
      WHERE n.need_id = $1
        AND n.status = 'ACTIVE'
        AND n.moderation_status = 'VISIBLE'
        AND g.verification_status = 'APPROVED'
        AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
    `,
    [needId]
  );

  return result.rows[0]?.contribution_type || null;
};

const createApplication = async ({ needId, userId, message }) => transactionRepository.withTransaction(async (client) => {
  await needLifecycleRepository.expireNeedIfDue(client, needId);
  const eligibleNeed = await client.query(
    `SELECT n.need_id
       FROM needs n
       JOIN ngos g ON g.ngo_id = n.ngo_id
       JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
      WHERE n.need_id = $1 AND n.contribution_type = 'VOLUNTEER'
        AND n.status = 'ACTIVE' AND n.moderation_status = 'VISIBLE'
        AND g.verification_status = 'APPROVED'
        AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
      FOR UPDATE OF n`,
    [needId]
  );
  if (!eligibleNeed.rows[0]) return null;
  const result = await client.query(
    `
      INSERT INTO volunteer_applications (need_id, user_id, message)
      SELECT n.need_id, $2, $3
      FROM needs n
      JOIN ngos g ON g.ngo_id = n.ngo_id
      JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
      WHERE n.need_id = $1
        AND n.contribution_type = 'VOLUNTEER'
        AND n.status = 'ACTIVE'
        AND n.moderation_status = 'VISIBLE'
        AND g.verification_status = 'APPROVED'
        AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
      RETURNING application_id, need_id, user_id, message, status, applied_at, updated_at
    `,
    [needId, userId, message]
  );
  const application = result.rows[0] || null;
  if (!application) return null;
  await notificationEvents.createApplicationReceived(client, application.application_id);
  return application;
});

const findApplicationsForNeed = async (needId) => {
  const result = await pool.query(
    `
      SELECT
        va.application_id, va.need_id, va.user_id AS applicant_id,
        va.message, va.status, va.applied_at, va.updated_at,
        u.name AS applicant_name, u.city AS applicant_city
      FROM volunteer_applications va
      JOIN users u ON u.user_id = va.user_id
      WHERE va.need_id = $1
      ORDER BY va.applied_at DESC, va.application_id
    `,
    [needId]
  );

  return result.rows;
};

const findApplicationsForUser = async (userId) => {
  const result = await pool.query(
    `
      SELECT va.application_id, va.need_id, va.status, va.message, va.resolution_reason,
             va.applied_at, va.updated_at, n.title AS need_title, n.status AS need_status,
             n.moderation_status AS need_moderation_status, n.deadline AS need_deadline,
             n.completed_at AS need_completed_at, n.closed_at AS need_closed_at,
             n.expired_at AS need_expired_at, g.name AS ngo_name
      FROM volunteer_applications va
      JOIN needs n ON n.need_id = va.need_id
      JOIN ngos g ON g.ngo_id = n.ngo_id
      WHERE va.user_id = $1
      ORDER BY va.applied_at DESC, va.application_id ASC
    `,
    [userId]
  );

  return result.rows;
};

const findApplicationReviewContext = async ({ needId, applicationId }) => {
  const result = await pool.query(
    `
      SELECT va.application_id, va.need_id, va.status,
             n.ngo_id, g.user_id AS ngo_user_id
      FROM volunteer_applications va
      JOIN needs n ON n.need_id = va.need_id
      JOIN ngos g ON g.ngo_id = n.ngo_id
      WHERE va.need_id = $1 AND va.application_id = $2
    `,
    [needId, applicationId]
  );

  return result.rows[0] || null;
};

const updateApplicationStatus = async ({ needId, applicationId, expectedStatus, status }) => {
  return transactionRepository.withTransaction(async (client) => {
    await needLifecycleRepository.expireNeedIfDue(client, needId);
    const needResult = await client.query(
      "SELECT need_id, status FROM needs WHERE need_id = $1 FOR UPDATE",
      [needId]
    );
    const need = needResult.rows[0];
    if (!need || (need.status === "CLOSED" && expectedStatus === "APPLIED")) return null;
    const result = await client.query(
      `
        UPDATE volunteer_applications
        SET status = $4, updated_at = NOW()
        WHERE need_id = $1 AND application_id = $2 AND status = $3
        RETURNING application_id, need_id, user_id, message, status, applied_at, updated_at
      `,
      [needId, applicationId, expectedStatus, status]
    );
    const application = result.rows[0] || null;
    if (!application) return null;
    const titleResult = await client.query("SELECT title AS need_title FROM needs WHERE need_id = $1", [application.need_id]);
    await notificationEvents.createApplicationStatus(client, {
      ...application,
      need_title: titleResult.rows[0]?.need_title || "the need",
    });
    return application;
  });
};

module.exports = {
  findNeedContributionType,
  createApplication,
  findApplicationsForNeed,
  findApplicationsForUser,
  findApplicationReviewContext,
  updateApplicationStatus,
};

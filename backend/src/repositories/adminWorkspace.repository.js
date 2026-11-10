const pool = require("../config/database");
const transactionRepository = require("./transaction.repository");

const getDashboard = async () => {
  const [counts, activity] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM users WHERE role = 'INDIVIDUAL') AS total_individuals,
        (SELECT COUNT(*)::int FROM users WHERE role = 'NGO') AS total_ngos,
        (SELECT COUNT(*)::int FROM ngos WHERE verification_status = 'APPROVED') AS verified_ngos,
        (SELECT COUNT(*)::int FROM ngos WHERE verification_status = 'PENDING') AS pending_ngos,
        (SELECT COUNT(*)::int FROM needs) AS total_needs,
        (SELECT COUNT(*)::int FROM needs n JOIN ngos g ON g.ngo_id = n.ngo_id JOIN users u ON u.user_id = g.user_id
          WHERE n.status IN ('ACTIVE', 'PARTIALLY_FULFILLED') AND n.moderation_status = 'VISIBLE'
            AND g.verification_status = 'APPROVED' AND NOT u.is_suspended) AS active_needs,
        (SELECT COUNT(*)::int FROM needs WHERE status IN ('COMPLETED', 'FULFILLED') OR completed_at IS NOT NULL) AS completed_needs,
        (SELECT COUNT(*)::int FROM volunteer_applications) AS total_applications,
        (SELECT COUNT(*)::int FROM contributions) AS total_contributions,
        (SELECT COUNT(*)::int FROM users WHERE is_suspended) AS suspended_users,
        (SELECT COUNT(*)::int FROM needs WHERE moderation_status = 'HIDDEN') AS hidden_needs
    `),
    pool.query(`
      (SELECT 'NGO_VERIFICATION' AS event_type, h.ngo_name_snapshot AS subject,
              h.action AS detail, h.created_at
         FROM ngo_verification_history h
        ORDER BY h.created_at DESC LIMIT 6)
      UNION ALL
      (SELECT 'USER_REGISTERED', u.name, u.role, u.created_at
         FROM users u ORDER BY u.created_at DESC LIMIT 6)
      UNION ALL
      (SELECT 'NEED_CREATED', n.title, n.status, n.created_at
         FROM needs n ORDER BY n.created_at DESC LIMIT 6)
      UNION ALL
      (SELECT 'ADMIN_ACTION',
              CASE WHEN h.target_type = 'USER'
                   THEN (SELECT u.name FROM users u WHERE u.user_id = h.target_id)
                   ELSE (SELECT n.title FROM needs n WHERE n.need_id = h.target_id)
              END AS subject,
              h.action AS detail, h.created_at
         FROM admin_action_history h ORDER BY h.created_at DESC LIMIT 6)
      ORDER BY created_at DESC LIMIT 10
    `),
  ]);
  return { ...counts.rows[0], recentActivity: activity.rows };
};

const listUsers = async ({ search, role, status, limit, offset }) => {
  const result = await pool.query(`
    SELECT user_id, name, email, role, email_verified, email_verified_at,
           phone, city, created_at, updated_at, is_suspended, suspended_at, suspension_reason,
           COUNT(*) OVER()::int AS total_count
      FROM users
     WHERE ($1::text IS NULL OR name ILIKE '%' || $1 || '%' OR email ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR role = $2)
       AND ($3::text IS NULL OR ($3 = 'SUSPENDED' AND is_suspended)
            OR ($3 = 'ACTIVE' AND NOT is_suspended))
     ORDER BY created_at DESC, user_id
     LIMIT $4 OFFSET $5
  `, [search || null, role || null, status || null, limit, offset]);
  return { items: result.rows.map(({ total_count, ...user }) => user), total: result.rows[0]?.total_count ?? 0 };
};

const getUser = async (userId) => {
  const result = await pool.query(`
    SELECT u.user_id, u.name, u.email, u.role, u.email_verified, u.email_verified_at,
           u.phone, u.city, u.created_at, u.updated_at, u.is_suspended,
           u.suspended_at, u.suspension_reason,
           n.ngo_id, n.name AS ngo_name, n.verification_status AS ngo_verification_status,
           (SELECT COUNT(*)::int FROM needs x WHERE x.ngo_id = n.ngo_id) AS ngo_need_count,
           (SELECT COUNT(*)::int FROM volunteer_applications a WHERE a.user_id = u.user_id) AS application_count,
           (SELECT COUNT(*)::int FROM contributions c WHERE c.user_id = u.user_id) AS contribution_count
      FROM users u LEFT JOIN ngos n ON n.user_id = u.user_id
     WHERE u.user_id = $1
  `, [userId]);
  if (!result.rows[0]) return null;
  const actions = await pool.query(`SELECT action, reason, created_at FROM admin_action_history
    WHERE target_type = 'USER' AND target_id = $1 ORDER BY created_at DESC`, [userId]);
  return { ...result.rows[0], adminActions: actions.rows };
};

const setUserSuspension = async ({ userId, adminUserId, suspended, reason }) =>
  transactionRepository.withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ngo_connect_admin_account_protection'))");
    const targetResult = await client.query(
      "SELECT user_id, role, is_suspended FROM users WHERE user_id = $1 FOR UPDATE", [userId]
    );
    const target = targetResult.rows[0];
    if (!target) return null;
    if (userId === adminUserId) {
      const error = new Error("Administrators cannot suspend or reactivate their own account");
      error.statusCode = 409;
      error.publicCode = "ADMIN_SELF_SUSPENSION_BLOCKED";
      throw error;
    }
    if (suspended && target.role === "ADMIN") {
      const admins = await client.query("SELECT COUNT(*)::int AS count FROM users WHERE role = 'ADMIN' AND NOT is_suspended");
      if (admins.rows[0].count <= 1) {
        const error = new Error("The last active administrator cannot be suspended");
        error.statusCode = 409;
        error.publicCode = "LAST_ADMIN_PROTECTED";
        throw error;
      }
    }
    const updated = await client.query(`
      UPDATE users SET is_suspended = $2,
        suspended_at = CASE WHEN $2 THEN NOW() ELSE NULL END,
        suspended_by_user_id = CASE WHEN $2 THEN $3::uuid ELSE NULL END,
        suspension_reason = CASE WHEN $2 THEN $4::text ELSE NULL END,
        updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, name, email, role, email_verified, phone, city, created_at,
                is_suspended, suspended_at, suspension_reason
    `, [userId, suspended, adminUserId, reason || null]);
    await client.query(`INSERT INTO admin_action_history (actor_user_id, target_type, target_id, action, reason)
      VALUES ($1, 'USER', $2, $3, $4)`, [adminUserId, userId, suspended ? "SUSPENDED" : "REACTIVATED", reason]);
    return updated.rows[0];
  });

const listNeeds = async ({ search, status, moderationStatus, contributionType, limit, offset }) => {
  const result = await pool.query(`
    SELECT n.need_id, n.title, n.status, n.moderation_status, n.contribution_type,
           n.created_at, n.updated_at, n.moderated_at, n.moderation_reason,
           g.ngo_id, g.name AS ngo_name, g.verification_status AS ngo_verification_status,
           c.name AS cause_name,
           COUNT(*) OVER()::int AS total_count
      FROM needs n JOIN ngos g ON g.ngo_id = n.ngo_id JOIN causes c ON c.cause_id = n.cause_id
     WHERE ($1::text IS NULL OR n.title ILIKE '%' || $1 || '%' OR g.name ILIKE '%' || $1 || '%')
       AND ($2::text IS NULL OR n.status = $2)
       AND ($3::text IS NULL OR n.moderation_status = $3)
       AND ($4::text IS NULL OR n.contribution_type = $4)
     GROUP BY n.need_id, g.ngo_id, g.name, c.name
     ORDER BY n.created_at DESC, n.need_id LIMIT $5 OFFSET $6
  `, [search || null, status || null, moderationStatus || null, contributionType || null, limit, offset]);
  return { items: result.rows.map(({ total_count, ...item }) => item), total: result.rows[0]?.total_count ?? 0 };
};

const getNeed = async (needId) => {
  const result = await pool.query(`
    SELECT n.need_id, n.ngo_id, n.cause_id, n.title, n.description, n.contribution_type,
           n.location, n.availability, n.quantity_required, n.quantity_fulfilled,
           n.priority, n.deadline, n.status, n.moderation_status, n.moderated_at,
           n.moderation_reason, n.completed_at, n.closed_at, n.expired_at, n.created_at, n.updated_at,
           g.name AS ngo_name, g.email AS ngo_email, g.city AS ngo_city,
           g.verification_status AS ngo_verification_status, c.name AS cause_name,
           (SELECT COUNT(*)::int FROM volunteer_applications a WHERE a.need_id = n.need_id) AS application_count,
           (SELECT COUNT(*)::int FROM contributions x WHERE x.need_id = n.need_id) AS contribution_count
      FROM needs n JOIN ngos g ON g.ngo_id = n.ngo_id JOIN causes c ON c.cause_id = n.cause_id
     WHERE n.need_id = $1
  `, [needId]);
  if (!result.rows[0]) return null;
  const actions = await pool.query(`SELECT action, reason, created_at FROM admin_action_history
    WHERE target_type = 'NEED' AND target_id = $1 ORDER BY created_at DESC`, [needId]);
  const lifecycle = await pool.query(`SELECT event_type, from_status, to_status, actor_type, reason, created_at
    FROM need_lifecycle_history WHERE need_id = $1 ORDER BY created_at ASC, history_id ASC`, [needId]);
  return { ...result.rows[0], adminActions: actions.rows, lifecycleHistory: lifecycle.rows };
};

const setNeedModeration = async ({ needId, adminUserId, hidden, reason }) =>
  transactionRepository.withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ngo_connect_admin_account_protection'))");
    const result = await client.query("SELECT need_id, moderation_status FROM needs WHERE need_id = $1 FOR UPDATE", [needId]);
    if (!result.rows[0]) return null;
    const updated = await client.query(`
      UPDATE needs SET moderation_status = $2,
        moderated_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
        moderated_by_user_id = CASE WHEN $3 THEN $4::uuid ELSE NULL END,
        moderation_reason = CASE WHEN $3 THEN $5::text ELSE NULL END,
        updated_at = NOW()
      WHERE need_id = $1
      RETURNING need_id, title, status, moderation_status, moderated_at, moderation_reason
    `, [needId, hidden ? "HIDDEN" : "VISIBLE", hidden, adminUserId, reason || null]);
    await client.query(`INSERT INTO admin_action_history (actor_user_id, target_type, target_id, action, reason)
      VALUES ($1, 'NEED', $2, $3, $4)`, [adminUserId, needId, hidden ? "HIDDEN" : "RESTORED", reason]);
    return updated.rows[0];
  });

const getAnalytics = async () => {
  const [registrations, verification, needs, completionDatesUnavailable, engagement, categories] = await Promise.all([
    pool.query(`SELECT date_trunc('month', created_at)::date AS month, role, COUNT(*)::int AS count
      FROM users WHERE created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
      GROUP BY 1, 2 ORDER BY 1, 2`),
    pool.query("SELECT verification_status AS status, COUNT(*)::int AS count FROM ngos GROUP BY verification_status ORDER BY verification_status"),
    pool.query(`WITH months AS (
        SELECT generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '11 months',
                               date_trunc('month', CURRENT_DATE), INTERVAL '1 month') AS month
      ), created AS (
        SELECT date_trunc('month', created_at) AS month, COUNT(*)::int AS count
          FROM needs
         WHERE created_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
         GROUP BY 1
      ), completed AS (
        SELECT date_trunc('month', completed_at) AS month, COUNT(*)::int AS count
          FROM needs
         WHERE completed_at >= date_trunc('month', CURRENT_DATE) - INTERVAL '11 months'
         GROUP BY 1
      )
      SELECT months.month::date AS month, COALESCE(created.count, 0)::int AS created,
             COALESCE(completed.count, 0)::int AS completed
        FROM months LEFT JOIN created USING (month) LEFT JOIN completed USING (month)
       ORDER BY months.month`),
    pool.query(`SELECT COUNT(*)::int AS count FROM needs
      WHERE status IN ('COMPLETED', 'FULFILLED') AND completed_at IS NULL`),
    pool.query(`SELECT months.month::date AS month,
      (SELECT COUNT(*)::int FROM volunteer_applications a WHERE date_trunc('month', a.applied_at) = months.month) AS applications,
      (SELECT COUNT(*)::int FROM contributions c WHERE date_trunc('month', c.created_at) = months.month) AS contributions
      FROM generate_series(date_trunc('month', CURRENT_DATE) - INTERVAL '11 months', date_trunc('month', CURRENT_DATE), INTERVAL '1 month') months(month)
      ORDER BY month`),
    pool.query("SELECT contribution_type, COUNT(*)::int AS count FROM needs GROUP BY contribution_type ORDER BY contribution_type"),
  ]);
  return { registrations: registrations.rows, ngoVerification: verification.rows, needs: needs.rows,
    completionDatesUnavailable: completionDatesUnavailable.rows[0].count,
    engagement: engagement.rows, needCategories: categories.rows };
};

module.exports = { getDashboard, listUsers, getUser, setUserSuspension, listNeeds, getNeed, setNeedModeration, getAnalytics };

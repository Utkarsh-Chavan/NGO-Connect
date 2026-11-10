const pool = require("../config/database");
const transactionRepository = require("./transaction.repository");
const notificationEvents = require("./notificationEvents.repository");

const recordNeedHistory = async (executor, {
  needId, eventType, fromStatus, toStatus, actorUserId = null,
  actorType, reason, eventKey,
}) => executor.query(
  `INSERT INTO need_lifecycle_history (
     need_id, event_type, from_status, to_status, actor_user_id, actor_type, reason, event_key
   ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
   ON CONFLICT (event_key) DO NOTHING`,
  [needId, eventType, fromStatus, toStatus, actorUserId, actorType, reason, eventKey]
);

const expireDueWithClient = async (client, needId = null, { notify = true } = {}) => {
  const result = await client.query(
    `WITH due AS MATERIALIZED (
       SELECT need_id, status
         FROM needs
        WHERE ($1::uuid IS NULL OR need_id = $1)
          AND deadline IS NOT NULL AND deadline <= clock_timestamp()
          AND status IN ('DRAFT', 'ACTIVE', 'PARTIALLY_FULFILLED')
        ORDER BY deadline, need_id
        FOR UPDATE SKIP LOCKED
     ), changed AS (
       UPDATE needs n
          SET status = 'EXPIRED',
              expired_at = COALESCE(n.expired_at, clock_timestamp()),
              updated_at = clock_timestamp()
         FROM due
        WHERE n.need_id = due.need_id
       RETURNING n.need_id, n.title, n.ngo_id, due.status AS from_status, n.status AS to_status
     ), history AS (
       INSERT INTO need_lifecycle_history (
         need_id, event_type, from_status, to_status, actor_type, reason, event_key
       )
       SELECT need_id, 'EXPIRED', from_status, to_status, 'SYSTEM',
              'The published deadline passed; new applications and contributions are closed.',
              'need-lifecycle:expired:' || need_id::text
         FROM changed
       ON CONFLICT (event_key) DO NOTHING
       RETURNING need_id
     )
     SELECT changed.* FROM changed JOIN history USING (need_id)`,
    [needId]
  );
  if (notify) {
    for (const need of result.rows) await notificationEvents.createNeedLifecycleNotices(client, { ...need, eventType: "NEED_EXPIRED" });
  }
  return result.rows;
};

const expireDueNeeds = async () => transactionRepository.withTransaction((client) => expireDueWithClient(client));

const expireNeedIfDue = async (client, needId, options) => {
  const rows = await expireDueWithClient(client, needId, options);
  return rows[0] || null;
};

const insertNeedHistory = recordNeedHistory;

const getPreservedEngagementCounts = async (client, needId) => {
  const result = await client.query(
    `SELECT
       (SELECT COUNT(*)::int FROM volunteer_applications WHERE need_id = $1 AND status = 'ACCEPTED') AS accepted_applications,
       (SELECT COUNT(*)::int FROM contributions WHERE need_id = $1 AND status = 'ACCEPTED') AS accepted_contributions,
       (SELECT COUNT(*)::int FROM contributions WHERE need_id = $1 AND status = 'IN_PROGRESS') AS in_progress_contributions`,
    [needId]
  );
  return result.rows[0];
};

const closeNeed = async ({ needId, ngoId, actorUserId }) => transactionRepository.withTransaction(async (client) => {
  let selected = await client.query(
    `SELECT need_id, ngo_id, title, status, deadline, completed_at, closed_at, expired_at
       FROM needs WHERE need_id = $1 AND ngo_id = $2 FOR UPDATE`,
    [needId, ngoId]
  );
  let need = selected.rows[0];
  if (!need) return { kind: "NOT_FOUND" };
  if (need.status === "CLOSED") {
    return { kind: "CLOSED", need, preservedEngagements: await getPreservedEngagementCounts(client, needId), alreadyClosed: true };
  }
  if (["COMPLETED", "FULFILLED"].includes(need.status)) return { kind: "COMPLETED" };

  await expireNeedIfDue(client, needId, { notify: false });
  selected = await client.query(
    `SELECT need_id, ngo_id, title, status, deadline, completed_at, closed_at, expired_at
       FROM needs WHERE need_id = $1 AND ngo_id = $2 FOR UPDATE`,
    [needId, ngoId]
  );
  need = selected.rows[0];

  const [applications, contributions] = await Promise.all([
    client.query(
      `SELECT application_id, user_id, status FROM volunteer_applications
        WHERE need_id = $1 AND status IN ('APPLIED', 'ACCEPTED') FOR UPDATE`, [needId]
    ),
    client.query(
      `SELECT contribution_id, user_id, contribution_type, status FROM contributions
        WHERE need_id = $1 AND status IN ('PENDING', 'ACCEPTED', 'IN_PROGRESS') FOR UPDATE`, [needId]
    ),
  ]);
  const engagements = [
    ...applications.rows.map((row) => ({ ...row, entityType: "APPLICATION", entityId: row.application_id })),
    ...contributions.rows.map((row) => ({ ...row, entityType: "CONTRIBUTION", entityId: row.contribution_id })),
  ];
  const pendingApplications = applications.rows.filter((row) => row.status === "APPLIED");
  const pendingContributions = contributions.rows.filter((row) => row.status === "PENDING");
  if (pendingApplications.length) await client.query(
    `UPDATE volunteer_applications
        SET status = 'REJECTED', resolution_reason = $2, updated_at = clock_timestamp()
      WHERE need_id = $1 AND status = 'APPLIED'`,
    [needId, "Need closed by the organization; the pending application was canceled."]
  );
  if (pendingContributions.length) await client.query(
    `UPDATE contributions
        SET status = 'REJECTED', resolution_reason = $2, updated_at = clock_timestamp()
      WHERE need_id = $1 AND status = 'PENDING'`,
    [needId, "Need closed by the organization; the pending contribution was canceled."]
  );

  const closed = await client.query(
    `UPDATE needs
        SET status = 'CLOSED', closed_at = COALESCE(closed_at, clock_timestamp()), updated_at = clock_timestamp()
      WHERE need_id = $1 AND ngo_id = $2
      RETURNING need_id, ngo_id, title, status, deadline, completed_at, closed_at, expired_at`,
    [needId, ngoId]
  );
  const closedNeed = closed.rows[0];
  await recordNeedHistory(client, {
    needId, eventType: "CLOSED", fromStatus: need.status, toStatus: "CLOSED", actorUserId,
    actorType: "NGO",
    reason: "The NGO closed this need. Pending applications and contributions were rejected; accepted and in-progress engagements remain active.",
    eventKey: `need-lifecycle:closed:${needId}`,
  });
  await notificationEvents.createNeedClosedNotices(client, { ...closedNeed, engagements });
  return {
    kind: "CLOSED", need: closedNeed,
    preservedEngagements: {
      accepted_applications: applications.rows.filter((row) => row.status === "ACCEPTED").length,
      accepted_contributions: contributions.rows.filter((row) => row.status === "ACCEPTED").length,
      in_progress_contributions: contributions.rows.filter((row) => row.status === "IN_PROGRESS").length,
    },
    canceledEngagements: { applications: pendingApplications.length, contributions: pendingContributions.length },
    alreadyClosed: false,
  };
});

const findHistoryForNeed = async (needId, executor = pool) => {
  const result = await executor.query(
    `SELECT event_type, from_status, to_status, actor_type, reason, created_at
       FROM need_lifecycle_history WHERE need_id = $1
      ORDER BY created_at ASC, history_id ASC`,
    [needId]
  );
  return result.rows;
};

module.exports = {
  expireDueNeeds,
  expireNeedIfDue,
  insertNeedHistory,
  closeNeed,
  findHistoryForNeed,
};

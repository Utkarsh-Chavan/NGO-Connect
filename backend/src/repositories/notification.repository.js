const pool = require("../config/database");

const notificationFields = `
  n.notification_id, n.event_type, n.title, n.message,
  n.related_entity_type, n.related_entity_id, n.created_at, n.read_at
`;

const listForUser = async (userId, { limit, offset, unreadOnly }) => {
  const result = await pool.query(
    `WITH filtered AS MATERIALIZED (
       SELECT notification_id, created_at
         FROM notifications
        WHERE recipient_user_id = $1
          AND ($2::boolean IS NOT TRUE OR read_at IS NULL)
     ), total AS (
       SELECT COUNT(*)::int AS total_count FROM filtered
     ), page AS (
       SELECT notification_id, created_at FROM filtered
        ORDER BY created_at DESC, notification_id DESC
        LIMIT $3 OFFSET $4
     )
     SELECT ${notificationFields}, total.total_count
       FROM total
       LEFT JOIN page p ON TRUE
       LEFT JOIN notifications n
         ON n.notification_id = p.notification_id
        AND n.recipient_user_id = $1
      ORDER BY p.created_at DESC NULLS LAST, p.notification_id DESC`,
    [userId, unreadOnly === true, limit, offset]
  );
  return {
    items: result.rows.filter((row) => row.notification_id !== null),
    total: result.rows[0]?.total_count ?? 0,
  };
};

const countUnreadForUser = async (userId) => {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS unread_count FROM notifications WHERE recipient_user_id = $1 AND read_at IS NULL",
    [userId]
  );
  return result.rows[0].unread_count;
};

const markReadForUser = async (notificationId, userId) => {
  const result = await pool.query(
    `UPDATE notifications
        SET read_at = COALESCE(read_at, NOW())
      WHERE notification_id = $1 AND recipient_user_id = $2
      RETURNING notification_id, event_type, title, message,
                related_entity_type, related_entity_id, created_at, read_at`,
    [notificationId, userId]
  );
  return result.rows[0] || null;
};

const markAllReadForUser = async (userId) => {
  const result = await pool.query(
    `UPDATE notifications SET read_at = NOW()
      WHERE recipient_user_id = $1 AND read_at IS NULL`,
    [userId]
  );
  return result.rowCount;
};

module.exports = { listForUser, countUnreadForUser, markReadForUser, markAllReadForUser };

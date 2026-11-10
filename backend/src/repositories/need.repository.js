const pool = require("../config/database");
const transactionRepository = require("./transaction.repository");
const needLifecycleRepository = require("./needLifecycle.repository");

const publicNeedFields = `
  n.need_id, n.ngo_id, n.cause_id, n.title, n.description,
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
  n.created_at, n.updated_at, g.name AS ngo_name, c.name AS cause_name
`;

const publicNeedDetailFields = `${publicNeedFields},
  g.website_url AS ngo_website_url,
  CASE WHEN n.contribution_type = 'MONEY' THEN g.email ELSE NULL END AS ngo_contact_email,
  CASE WHEN n.contribution_type = 'MONEY' THEN g.phone ELSE NULL END AS ngo_contact_phone
`;

const createNeed = async ({
  ngoId, causeId, title, description, contributionType, location,
  availability, quantityRequired, priority, deadline, status, actorUserId,
}) => transactionRepository.withTransaction(async (client) => {
  const result = await client.query(
    `
      INSERT INTO needs (
        ngo_id, cause_id, title, description, contribution_type, location,
        availability, quantity_required, priority, deadline, status
      )
      SELECT $1, c.cause_id, $3, $4, $5, $6, $7, $8, $9, $10, $11::varchar
      FROM causes c
      JOIN ngos g ON g.ngo_id = $1
      WHERE c.cause_id = $2 AND c.is_active = TRUE
        AND ($11::varchar <> 'ACTIVE' OR g.verification_status = 'APPROVED')
        AND ($10::timestamptz IS NULL OR $10::timestamptz > clock_timestamp())
      RETURNING
        need_id, ngo_id, cause_id, title, description, contribution_type,
        location, availability, quantity_required, quantity_fulfilled,
        priority, deadline, status, created_at, updated_at,
        completed_at, closed_at, expired_at
    `,
    [ngoId, causeId, title, description, contributionType, location,
      availability, quantityRequired, priority, deadline, status]
  );
  const need = result.rows[0] || null;
  if (need) await needLifecycleRepository.insertNeedHistory(client, {
    needId: need.need_id,
    eventType: "CREATED",
    fromStatus: null,
    toStatus: need.status,
    actorUserId,
    actorType: "NGO",
    reason: "Need created.",
    eventKey: `need-lifecycle:created:${need.need_id}`,
  });
  return need;
});

const findPublicNeeds = async ({ search = null, causeId = null, contributionType = null, location = null, limit, offset }) => {
  const result = await pool.query(
    `
      WITH filtered AS MATERIALIZED (
        SELECT n.need_id, n.created_at
        FROM needs n
        JOIN ngos g ON g.ngo_id = n.ngo_id
        JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
        JOIN causes c ON c.cause_id = n.cause_id
        WHERE n.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
          AND n.moderation_status = 'VISIBLE'
          AND g.verification_status = 'APPROVED'
          AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
          AND ($1::text IS NULL OR position(lower($1) in lower(n.title)) > 0
               OR position(lower($1) in lower(n.description)) > 0)
          AND ($2::uuid IS NULL OR n.cause_id = $2::uuid)
          AND ($3::text IS NULL OR n.contribution_type = $3)
          AND ($4::text IS NULL OR position(lower($4) in lower(coalesce(n.location, ''))) > 0
               OR position(lower($4) in lower(g.city)) > 0)
      ), total AS (
        SELECT COUNT(*)::int AS total_count FROM filtered
      ), page AS (
        SELECT need_id, created_at FROM filtered
        ORDER BY created_at DESC, need_id
        LIMIT $5 OFFSET $6
      )
      SELECT ${publicNeedFields}, total.total_count
      FROM total
      LEFT JOIN page p ON TRUE
      LEFT JOIN needs n ON n.need_id = p.need_id
      LEFT JOIN ngos g ON g.ngo_id = n.ngo_id
      LEFT JOIN users u ON u.user_id = g.user_id
      LEFT JOIN causes c ON c.cause_id = n.cause_id
      ORDER BY p.created_at DESC NULLS LAST, p.need_id
    `,
    [search || null, causeId || null, contributionType || null, location || null, limit, offset]
  );

  const total = result.rows[0]?.total_count ?? 0;
  return { items: result.rows.filter((row) => row.need_id !== null), total };
};

const findPublicNeedById = async (needId) => {
  const result = await pool.query(
    `
      SELECT ${publicNeedDetailFields}
      FROM needs n
      JOIN ngos g ON g.ngo_id = n.ngo_id
      JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
      JOIN causes c ON c.cause_id = n.cause_id
      WHERE n.need_id = $1
        AND n.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
        AND n.moderation_status = 'VISIBLE'
        AND g.verification_status = 'APPROVED'
        AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
    `,
    [needId]
  );

  return result.rows[0] || null;
};

const findNeedOwnerById = async (needId) => {
  const result = await pool.query(
    `SELECT need_id, ngo_id FROM needs WHERE need_id = $1`,
    [needId]
  );

  return result.rows[0] || null;
};

const findOwnedNeedById = async (needId, ngoId) => {
  const result = await pool.query(
    `
      SELECT ${publicNeedDetailFields},
        (SELECT COUNT(*)::int FROM volunteer_applications a WHERE a.need_id = n.need_id AND a.status = 'ACCEPTED') AS accepted_application_count,
        (SELECT COUNT(*)::int FROM contributions x WHERE x.need_id = n.need_id AND x.status = 'ACCEPTED') AS accepted_contribution_count,
        (SELECT COUNT(*)::int FROM contributions x WHERE x.need_id = n.need_id AND x.status = 'IN_PROGRESS') AS in_progress_contribution_count
      FROM needs n
      JOIN ngos g ON g.ngo_id = n.ngo_id
      JOIN causes c ON c.cause_id = n.cause_id
      WHERE n.need_id = $1 AND n.ngo_id = $2
    `,
    [needId, ngoId]
  );
  return result.rows[0] || null;
};

const updateNeed = async ({
  needId, ngoId, causeId, title, description, contributionType, location,
  availability, quantityRequired, priority, deadline, status, actorUserId,
}) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await needLifecycleRepository.expireNeedIfDue(client, needId);
    const currentResult = await client.query(
      `SELECT need_id, contribution_type, quantity_fulfilled, status
         FROM needs
        WHERE need_id = $1 AND ngo_id = $2
        FOR UPDATE`,
      [needId, ngoId]
    );
    const current = currentResult.rows[0];
    if (!current) {
      await client.query("ROLLBACK");
      return null;
    }
    if (current.status === "EXPIRED" || current.status === "CLOSED"
        || current.status === "COMPLETED" || current.status === "FULFILLED") {
      await client.query("ROLLBACK");
      return { kind: current.status === "EXPIRED" ? "EXPIRED" : "NOT_EDITABLE" };
    }

    const reservationResult = await client.query(
      `SELECT COALESCE(SUM(quantity), 0)::bigint AS reserved_quantity
         FROM contributions
        WHERE need_id = $1 AND contribution_type = 'MATERIAL'
          AND status IN ('ACCEPTED', 'IN_PROGRESS')`,
      [needId]
    );
    const reserved = Number(reservationResult.rows[0]?.reserved_quantity || 0);
    if (current.contribution_type === "MATERIAL" && contributionType !== "MATERIAL"
        && (reserved > 0 || current.quantity_fulfilled > 0)) {
      await client.query("ROLLBACK");
      return { kind: "RESERVATIONS_EXIST" };
    }
    if (contributionType === "MATERIAL" && quantityRequired !== null
        && current.quantity_fulfilled + reserved > quantityRequired) {
      await client.query("ROLLBACK");
      return { kind: "OVER_COMMITTED" };
    }

    const result = await client.query(
      `
        UPDATE needs n
        SET cause_id = c.cause_id,
            title = $3,
            description = $4,
            contribution_type = $5,
            location = $6,
            availability = $7,
            quantity_required = $8,
            priority = $9,
            deadline = $10::timestamptz,
            status = $11::varchar,
            updated_at = NOW()
        FROM causes c, ngos g
        WHERE n.need_id = $1 AND n.ngo_id = $2
          AND g.ngo_id = $2
          AND c.cause_id = $12 AND c.is_active = TRUE
          AND ($11::varchar <> 'ACTIVE' OR g.verification_status = 'APPROVED')
          AND ($10::timestamptz IS NULL OR $10::timestamptz > clock_timestamp())
          AND n.status IN ('DRAFT', 'ACTIVE')
          AND (n.status = 'DRAFT' OR $11::varchar = 'ACTIVE')
        RETURNING
          n.need_id, n.ngo_id, n.cause_id, n.title, n.description,
          n.contribution_type, n.location, n.availability, n.quantity_required,
          n.quantity_fulfilled, n.priority, n.deadline, n.status,
          n.created_at, n.updated_at, n.completed_at, n.closed_at, n.expired_at
      `,
      [needId, ngoId, title, description, contributionType, location,
        availability, quantityRequired, priority, deadline, status, causeId]
    );
    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return null;
    }
    if (current.status !== result.rows[0].status) await needLifecycleRepository.insertNeedHistory(client, {
      needId,
      eventType: "ACTIVATED",
      fromStatus: current.status,
      toStatus: result.rows[0].status,
      actorUserId,
      actorType: "NGO",
      reason: current.status === "DRAFT" && result.rows[0].status === "ACTIVE" ? "Need published by its NGO." : "Need lifecycle status changed.",
      eventKey: `need-lifecycle:${current.status.toLowerCase()}:${result.rows[0].status.toLowerCase()}:${needId}`,
    });
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createNeed,
  findPublicNeeds,
  findPublicNeedById,
  findNeedOwnerById,
  findOwnedNeedById,
  updateNeed,
};

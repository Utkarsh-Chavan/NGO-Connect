const pool = require("../config/database");
const notificationEvents = require("./notificationEvents.repository");
const needLifecycleRepository = require("./needLifecycle.repository");

const contributionFields = `
  contribution_id, need_id, user_id, contribution_type,
  description, quantity, amount, status, created_at, updated_at
`;

const createContribution = async ({ needId, userId, contributionType, description, quantity, amount }) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await needLifecycleRepository.expireNeedIfDue(client, needId);
    const needResult = await client.query(
      `
        SELECT n.need_id
        FROM needs n
        JOIN ngos g ON g.ngo_id = n.ngo_id
        JOIN users u ON u.user_id = g.user_id AND u.is_suspended = FALSE
        WHERE n.need_id = $1
          AND n.status IN ('ACTIVE', 'PARTIALLY_FULFILLED')
          AND n.moderation_status = 'VISIBLE'
          AND g.verification_status = 'APPROVED'
          AND (n.deadline IS NULL OR n.deadline > clock_timestamp())
          AND n.contribution_type = $2
        FOR UPDATE
      `,
      [needId, contributionType]
    );
    if (!needResult.rows[0]) {
      // Preserve an expiry transition performed above even though the attempted
      // contribution is rejected. No contribution data has been inserted yet.
      await client.query("COMMIT");
      return null;
    }

    const result = await client.query(
      `
        INSERT INTO contributions (
          need_id, user_id, contribution_type, description, quantity, amount
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING ${contributionFields}
      `,
      [needId, userId, contributionType, description, quantity, amount]
    );
    await notificationEvents.createContributionReceived(client, result.rows[0].contribution_id);
    await client.query("COMMIT");
    return result.rows[0];
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
};

const findContributionsForNeed = async (needId) => {
  const result = await pool.query(
    `
      SELECT ${contributionFields}
      FROM contributions
      WHERE need_id = $1
      ORDER BY created_at DESC, contribution_id
    `,
    [needId]
  );

  return result.rows;
};

const findContributionsForUser = async (userId) => {
  const result = await pool.query(
    `
      SELECT c.contribution_id, c.need_id, n.title AS need_title, n.status AS need_status,
             n.moderation_status AS need_moderation_status, n.deadline AS need_deadline,
             n.completed_at AS need_completed_at, n.closed_at AS need_closed_at,
             n.expired_at AS need_expired_at, c.resolution_reason,
             c.contribution_type, c.quantity, c.amount, c.description,
             c.status, c.created_at, g.name AS ngo_name
      FROM contributions c
      JOIN needs n ON n.need_id = c.need_id
      JOIN ngos g ON g.ngo_id = n.ngo_id
      WHERE c.user_id = $1
      ORDER BY c.created_at DESC, c.contribution_id ASC
    `,
    [userId]
  );

  return result.rows;
};

const findReservedMaterialQuantity = async (executor, needId, excludedContributionId = null) => {
  const result = await executor.query(
    `
      SELECT COALESCE(SUM(quantity), 0)::bigint AS reserved_quantity
      FROM contributions
      WHERE need_id = $1
        AND contribution_type = 'MATERIAL'
        AND status IN ('ACCEPTED', 'IN_PROGRESS')
        AND ($2::uuid IS NULL OR contribution_id <> $2::uuid)
    `,
    [needId, excludedContributionId]
  );
  return Number(result.rows[0]?.reserved_quantity || 0);
};

const transitionContribution = async ({ needId, contributionId, userId, ngoId, expectedStatus, status }) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await needLifecycleRepository.expireNeedIfDue(client, needId);

    // Every completion for a need locks this row first, serializing fulfillment totals.
    const needResult = await client.query(
      `
        SELECT n.need_id, n.ngo_id, n.title AS need_title, n.contribution_type, n.quantity_required,
               n.quantity_fulfilled, n.status AS need_status,
               g.user_id AS ngo_user_id
        FROM needs n
        JOIN ngos g ON g.ngo_id = n.ngo_id
        WHERE n.need_id = $1
        FOR UPDATE OF n
      `,
      [needId]
    );
    const need = needResult.rows[0];
    if (!need) {
      await client.query("ROLLBACK");
      return { kind: "NOT_FOUND" };
    }
    if (need.ngo_id !== ngoId || need.ngo_user_id !== userId) {
      await client.query("ROLLBACK");
      return { kind: "FORBIDDEN" };
    }

    const contributionResult = await client.query(
      `
        SELECT contribution_id, need_id, user_id, contribution_type,
               description, quantity, amount, status, created_at, updated_at
        FROM contributions
        WHERE need_id = $1 AND contribution_id = $2
        FOR UPDATE
      `,
      [needId, contributionId]
    );
    const contribution = contributionResult.rows[0];
    if (!contribution) {
      await client.query("ROLLBACK");
      return { kind: "NOT_FOUND" };
    }
    if (contribution.contribution_type === "MONEY") {
      await client.query("ROLLBACK");
      return { kind: "EXTERNAL_SUPPORT_ONLY" };
    }
    if (contribution.status !== expectedStatus) {
      await client.query("ROLLBACK");
      return { kind: "CONFLICT" };
    }

    if (need.status === "CLOSED" && expectedStatus === "PENDING") {
      await client.query("ROLLBACK");
      return { kind: "CONFLICT" };
    }

    if (status === "ACCEPTED" && contribution.contribution_type === "MATERIAL") {
      if (need.contribution_type !== "MATERIAL"
          || !Number.isInteger(contribution.quantity)
          || contribution.quantity <= 0) {
        await client.query("ROLLBACK");
        return { kind: "NOT_FULFILLABLE" };
      }
      const reserved = await findReservedMaterialQuantity(client, needId);
      if (need.quantity_required !== null
          && need.quantity_fulfilled + reserved + contribution.quantity > need.quantity_required) {
        await client.query("ROLLBACK");
        return { kind: "OVER_COMMITTED" };
      }
    }

    if (status === "COMPLETED" && contribution.contribution_type === "MATERIAL") {
      if (need.contribution_type !== "MATERIAL"
          || !Number.isInteger(contribution.quantity)
          || contribution.quantity <= 0
          || !["ACTIVE", "PARTIALLY_FULFILLED", "EXPIRED", "CLOSED"].includes(need.need_status)) {
        await client.query("ROLLBACK");
        return { kind: "NOT_FULFILLABLE" };
      }

      const nextFulfilled = need.quantity_fulfilled + contribution.quantity;
      const otherReserved = await findReservedMaterialQuantity(client, needId, contributionId);
      if (nextFulfilled > 2147483647
          || (need.quantity_required !== null
            && nextFulfilled + otherReserved > need.quantity_required)) {
        await client.query("ROLLBACK");
        return { kind: "OVER_FULFILLED" };
      }

      const needUpdate = await client.query(
        `
          UPDATE needs
          SET quantity_fulfilled = $2,
              status = CASE
                WHEN status = 'CLOSED' THEN 'CLOSED'
                WHEN quantity_required IS NULL THEN status
                WHEN $2 >= quantity_required THEN 'COMPLETED'
                WHEN status = 'EXPIRED' THEN 'EXPIRED'
                ELSE 'PARTIALLY_FULFILLED'
              END,
              completed_at = CASE
                WHEN quantity_required IS NOT NULL AND $2 >= quantity_required
                  THEN COALESCE(completed_at, clock_timestamp())
                ELSE completed_at
              END,
              updated_at = NOW()
          WHERE need_id = $1
        RETURNING status, completed_at
        `,
        [needId, nextFulfilled]
      );
      const updatedNeed = needUpdate.rows[0];
      if (updatedNeed?.completed_at && !need.completed_at) {
        const needNowClosed = updatedNeed.status === "CLOSED";
        await needLifecycleRepository.insertNeedHistory(client, {
          needId,
          eventType: needNowClosed ? "FULFILLMENT_COMPLETED" : "COMPLETED",
          fromStatus: need.need_status,
          toStatus: updatedNeed.status,
          actorUserId: userId,
          actorType: "NGO",
          reason: "Accepted material engagements fulfilled the required quantity.",
          eventKey: `need-lifecycle:completed:${needId}`,
        });
      }
    }

    const updateResult = await client.query(
      `
        UPDATE contributions
        SET status = $4, updated_at = NOW()
        WHERE need_id = $1 AND contribution_id = $2 AND status = $3
        RETURNING ${contributionFields}
      `,
      [needId, contributionId, expectedStatus, status]
    );
    if (!updateResult.rows[0]) {
      await client.query("ROLLBACK");
      return { kind: "CONFLICT" };
    }

    await notificationEvents.createContributionStatus(client, {
      ...updateResult.rows[0],
      need_title: need.need_title,
    });

    await client.query("COMMIT");
    return { kind: "UPDATED", data: updateResult.rows[0] };
  } catch (error) {
    try { await client.query("ROLLBACK"); } catch {}
    throw error;
  } finally {
    client.release();
  }
};

module.exports = {
  createContribution,
  findContributionsForNeed,
  findContributionsForUser,
  findReservedMaterialQuantity,
  transitionContribution,
};

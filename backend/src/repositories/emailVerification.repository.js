const insertToken = async (client, { userId, tokenHash, ttlSeconds }) => {
  const result = await client.query(
    `
      INSERT INTO email_verification_tokens (user_id, token_hash, expires_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP + ($3::integer * INTERVAL '1 second'))
      RETURNING token_id, expires_at
    `,
    [userId, tokenHash, ttlSeconds]
  );

  return result.rows[0];
};

const findTokenOwner = async (client, tokenHash) => {
  const result = await client.query(
    `
      SELECT token_id, user_id, expires_at, consumed_at, invalidated_at
      FROM email_verification_tokens
      WHERE token_hash = $1
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
};

const consumeToken = async (client, tokenHash) => {
  const result = await client.query(
    `
      UPDATE email_verification_tokens
      SET consumed_at = clock_timestamp()
      WHERE token_hash = $1
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND expires_at > clock_timestamp()
      RETURNING token_id, user_id
    `,
    [tokenHash]
  );

  return result.rows[0] || null;
};

const invalidateOutstandingTokens = async (client, userId, exceptTokenId = null) => {
  await client.query(
    `
      UPDATE email_verification_tokens
      SET invalidated_at = clock_timestamp()
      WHERE user_id = $1
        AND consumed_at IS NULL
        AND invalidated_at IS NULL
        AND ($2::uuid IS NULL OR token_id <> $2::uuid)
    `,
    [userId, exceptTokenId]
  );
};

const getIssueStats = async (client, userId) => {
  const result = await client.query(
    `
      SELECT
        COUNT(*) FILTER (
          WHERE created_at >= clock_timestamp() - INTERVAL '24 hours'
        )::integer AS issued_in_24_hours,
        MAX(created_at) AS latest_issue_at
      FROM email_verification_tokens
      WHERE user_id = $1
    `,
    [userId]
  );

  return result.rows[0];
};

module.exports = {
  insertToken,
  findTokenOwner,
  consumeToken,
  invalidateOutstandingTokens,
  getIssueStats,
};

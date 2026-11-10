const pool = require("../config/database");
const ngoVerificationRepository = require("./ngoVerification.repository");

const createNgo = async ({ userId, name, description, email, phone, address, city, websiteUrl }) => {
  const query = `
    INSERT INTO ngos (
      user_id, name, description, email, phone, address, city, website_url, verification_status
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'NOT_SUBMITTED')
    RETURNING
      ngo_id, user_id, name, description, email, phone, address, city, website_url,
      verification_status, created_at, updated_at
  `;

  const result = await pool.query(query, [
    userId, name, description, email, phone, address, city, websiteUrl ?? null,
  ]);

  return result.rows[0];
};

const findNgoByUserId = async (userId) => {
  const query = `
    SELECT
      ngo_id, user_id, name, description, email, phone, address, city, website_url,
      verification_status, created_at, updated_at
    FROM ngos
    WHERE user_id = $1
  `;

  const result = await pool.query(query, [userId]);

  return result.rows[0] || null;
};

const updateNgoByUserId = async ({ userId, name, description, email, phone, address, city, websiteUrl, websiteUrlProvided }) => {
  const query = `
    UPDATE ngos
    SET
      name = $2,
      description = $3,
      email = $4,
      phone = $5,
      address = $6,
      city = $7,
      website_url = CASE WHEN $8 THEN $9 ELSE website_url END,
      updated_at = NOW()
    WHERE user_id = $1
    RETURNING
      ngo_id, user_id, name, description, email, phone, address, city, website_url,
      verification_status, created_at, updated_at
  `;

  const result = await pool.query(query, [
    userId, name, description, email, phone, address, city, websiteUrlProvided, websiteUrl ?? null,
  ]);

  return result.rows[0] || null;
};

const findPendingNgos = async ({ limit, offset }) => {
  const result = await pool.query(
    `
      SELECT
        ngo_id, name, description, email, phone, address, city, website_url,
        verification_status, created_at, updated_at
      FROM ngos
      WHERE verification_status = 'PENDING'
      ORDER BY created_at ASC, ngo_id ASC
      LIMIT $1 OFFSET $2
    `,
    [limit, offset]
  );

  return result.rows;
};

const updateNgoVerificationStatus = async (decision) =>
  ngoVerificationRepository.applyDecision(decision);

module.exports = {
  createNgo,
  findNgoByUserId,
  updateNgoByUserId,
  findPendingNgos,
  updateNgoVerificationStatus,
};

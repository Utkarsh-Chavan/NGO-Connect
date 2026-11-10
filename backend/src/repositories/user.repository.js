const pool = require("../config/database");

const findUserByEmail = async (email, executor = pool) => {
  const query = `
    SELECT
      user_id,
      name,
      email,
      password_hash,
      role,
      email_verified,
      is_suspended,
      phone,
      city,
      availability,
      created_at,
      updated_at
    FROM users
    WHERE email = $1
  `;

  const result = await executor.query(query, [email]);

  return result.rows[0] || null;
};

const findAuthStatusById = async (userId) => {
  const result = await pool.query("SELECT user_id, is_suspended FROM users WHERE user_id = $1", [userId]);
  return result.rows[0] || null;
};

const lockVerificationAccountByEmail = async (client, email) => {
  const result = await client.query(
    `
      SELECT user_id, name, email, email_verified
      FROM users
      WHERE email = $1
      FOR UPDATE
    `,
    [email]
  );

  return result.rows[0] || null;
};

const lockUserById = async (client, userId) => {
  const result = await client.query(
    `SELECT user_id FROM users WHERE user_id = $1 FOR UPDATE`,
    [userId]
  );

  return result.rows[0] || null;
};

const markEmailVerified = async (client, userId) => {
  const result = await client.query(
    `
      UPDATE users
      SET email_verified = TRUE,
          email_verified_at = COALESCE(email_verified_at, clock_timestamp()),
          updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id
    `,
    [userId]
  );

  return result.rows[0] || null;
};

const findUserById = async (userId) => {
  const query = `
    SELECT
      user_id,
      name,
      email,
      role,
      phone,
      city,
      availability,
      created_at,
      updated_at
    FROM users
    WHERE user_id = $1
  `;

  const result = await pool.query(query, [userId]);

  return result.rows[0] || null;
};

const updateUserProfile = async (userId, { name, phone, city, availability }) => {
  const result = await pool.query(
    `
      UPDATE users
      SET name = $2, phone = $3, city = $4, availability = $5, updated_at = NOW()
      WHERE user_id = $1
      RETURNING user_id, name, email, role, phone, city, availability, created_at, updated_at
    `,
    [userId, name, phone, city, availability]
  );
  return result.rows[0] || null;
};

const createUser = async ({
  userId,
  name,
  email,
  passwordHash,
  role,
  phone,
  city,
  availability,
}, executor = pool) => {
  const query = `
    INSERT INTO users (
      user_id,
      name,
      email,
      password_hash,
      role,
      phone,
      city,
      availability,
      created_at,
      updated_at
    )
    VALUES (
      $1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW()
    )
    RETURNING
      user_id,
      name,
      email,
      role,
      email_verified,
      phone,
      city,
      availability,
      created_at,
      updated_at
  `;

  const values = [
    userId,
    name,
    email,
    passwordHash,
    role,
    phone,
    city,
    availability,
  ];

  const result = await executor.query(query, values);

  return result.rows[0];
};

module.exports = {
  findUserByEmail,
  findAuthStatusById,
  lockVerificationAccountByEmail,
  lockUserById,
  markEmailVerified,
  findUserById,
  updateUserProfile,
  createUser,
};

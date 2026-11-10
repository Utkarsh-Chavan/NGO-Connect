const pool = require("../config/database");

const findAvailableCauses = async () => {
  const query = `
    SELECT cause_id, name, description, is_active, created_at, updated_at
    FROM causes
    WHERE is_active = TRUE
    ORDER BY name ASC
  `;

  const result = await pool.query(query);

  return result.rows;
};

const findAvailableCauseById = async (causeId) => {
  const query = `
    SELECT cause_id, name, description, is_active, created_at, updated_at
    FROM causes
    WHERE cause_id = $1 AND is_active = TRUE
  `;

  const result = await pool.query(query, [causeId]);

  return result.rows[0] || null;
};

module.exports = {
  findAvailableCauses,
  findAvailableCauseById,
};

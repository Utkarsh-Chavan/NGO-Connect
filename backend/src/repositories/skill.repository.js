const pool = require("../config/database");

const findAvailableSkills = async () => {
  const query = `
    SELECT skill_id, name, description, is_active, created_at, updated_at
    FROM skills
    WHERE is_active = TRUE
    ORDER BY name ASC
  `;

  const result = await pool.query(query);

  return result.rows;
};

const findAvailableSkillById = async (skillId) => {
  const query = `
    SELECT skill_id, name, description, is_active, created_at, updated_at
    FROM skills
    WHERE skill_id = $1 AND is_active = TRUE
  `;

  const result = await pool.query(query, [skillId]);

  return result.rows[0] || null;
};

module.exports = {
  findAvailableSkills,
  findAvailableSkillById,
};

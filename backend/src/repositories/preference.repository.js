const pool = require("../config/database");

const findUserPreferences = async (userId) => {
  const [causesResult, skillsResult] = await Promise.all([
    pool.query(
      `
        SELECT c.cause_id, c.name, c.description, c.is_active
        FROM user_causes uc
        JOIN causes c ON c.cause_id = uc.cause_id
        WHERE uc.user_id = $1
        ORDER BY c.name ASC
      `,
      [userId]
    ),
    pool.query(
      `
        SELECT s.skill_id, s.name, s.description, s.is_active,
               us.proficiency_level
        FROM user_skills us
        JOIN skills s ON s.skill_id = us.skill_id
        WHERE us.user_id = $1
        ORDER BY s.name ASC
      `,
      [userId]
    ),
  ]);

  return {
    causes: causesResult.rows,
    skills: skillsResult.rows,
  };
};

const addUserCause = async (userId, causeId) => {
  const result = await pool.query(
    `
      INSERT INTO user_causes (user_id, cause_id)
      SELECT $1, c.cause_id
      FROM causes c
      WHERE c.cause_id = $2 AND c.is_active = TRUE
      RETURNING user_id, cause_id, created_at
    `,
    [userId, causeId]
  );

  return result.rows[0] || null;
};

const removeUserCause = async (userId, causeId) => {
  const result = await pool.query(
    `
      DELETE FROM user_causes
      WHERE user_id = $1 AND cause_id = $2
      RETURNING user_id, cause_id, created_at
    `,
    [userId, causeId]
  );

  return result.rows[0] || null;
};

const addUserSkill = async (userId, skillId, proficiencyLevel) => {
  const values = [userId, skillId];
  const proficiencyColumn = proficiencyLevel === undefined ? "" : ", proficiency_level";
  const proficiencyValue = proficiencyLevel === undefined ? "" : ", $3";

  if (proficiencyLevel !== undefined) values.push(proficiencyLevel);

  const result = await pool.query(
    `
      INSERT INTO user_skills (user_id, skill_id${proficiencyColumn})
      SELECT $1, s.skill_id${proficiencyValue}
      FROM skills s
      WHERE s.skill_id = $2 AND s.is_active = TRUE
      RETURNING user_id, skill_id, proficiency_level, created_at
    `,
    values
  );

  return result.rows[0] || null;
};

const updateUserSkillProficiency = async (userId, skillId, proficiencyLevel) => {
  const result = await pool.query(
    `
      UPDATE user_skills
      SET proficiency_level = $3
      WHERE user_id = $1 AND skill_id = $2
      RETURNING user_id, skill_id, proficiency_level, created_at
    `,
    [userId, skillId, proficiencyLevel]
  );

  return result.rows[0] || null;
};

const removeUserSkill = async (userId, skillId) => {
  const result = await pool.query(
    `
      DELETE FROM user_skills
      WHERE user_id = $1 AND skill_id = $2
      RETURNING user_id, skill_id, proficiency_level, created_at
    `,
    [userId, skillId]
  );

  return result.rows[0] || null;
};

module.exports = {
  findUserPreferences,
  addUserCause,
  removeUserCause,
  addUserSkill,
  updateUserSkillProficiency,
  removeUserSkill,
};

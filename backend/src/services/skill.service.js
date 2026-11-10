const skillRepository = require("../repositories/skill.repository");

const listAvailableSkills = async () => skillRepository.findAvailableSkills();

const getAvailableSkill = async (skillId) => {
  const skill = await skillRepository.findAvailableSkillById(skillId);

  if (!skill) {
    const error = new Error("Skill not found");
    error.statusCode = 404;
    throw error;
  }

  return skill;
};

module.exports = {
  listAvailableSkills,
  getAvailableSkill,
};

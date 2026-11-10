const preferenceRepository = require("../repositories/preference.repository");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const translateInsertError = (error, itemLabel) => {
  if (error.code === "23505") {
    throw createError(`${itemLabel} is already selected`, 409);
  }

  if (error.code === "23503") {
    throw createError(`${itemLabel} does not exist`, 404);
  }

  throw error;
};

const getUserPreferences = (userId) => preferenceRepository.findUserPreferences(userId);

const addCause = async (userId, causeId) => {
  try {
    const selection = await preferenceRepository.addUserCause(userId, causeId);
    if (!selection) throw createError("Cause not found or inactive", 404);
    return selection;
  } catch (error) {
    translateInsertError(error, "Cause");
  }
};

const removeCause = async (userId, causeId) => {
  const selection = await preferenceRepository.removeUserCause(userId, causeId);
  if (!selection) throw createError("Cause selection not found", 404);
  return selection;
};

const addSkill = async (userId, skillId, proficiencyLevel) => {
  try {
    const selection = await preferenceRepository.addUserSkill(userId, skillId, proficiencyLevel);
    if (!selection) throw createError("Skill not found or inactive", 404);
    return selection;
  } catch (error) {
    translateInsertError(error, "Skill");
  }
};

const updateSkillProficiency = async (userId, skillId, proficiencyLevel) => {
  const selection = await preferenceRepository.updateUserSkillProficiency(
    userId, skillId, proficiencyLevel
  );
  if (!selection) throw createError("Skill selection not found", 404);
  return selection;
};

const removeSkill = async (userId, skillId) => {
  const selection = await preferenceRepository.removeUserSkill(userId, skillId);
  if (!selection) throw createError("Skill selection not found", 404);
  return selection;
};

module.exports = {
  getUserPreferences,
  addCause,
  removeCause,
  addSkill,
  updateSkillProficiency,
  removeSkill,
};

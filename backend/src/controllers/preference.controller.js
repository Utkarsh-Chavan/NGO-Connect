const preferenceService = require("../services/preference.service");

const getPreferences = async (req, res, next) => {
  try {
    const preferences = await preferenceService.getUserPreferences(req.user.userId);
    res.status(200).json({ success: true, message: "Preferences retrieved successfully", data: preferences });
  } catch (error) {
    next(error);
  }
};

const addCause = async (req, res, next) => {
  try {
    const selection = await preferenceService.addCause(req.user.userId, req.body.causeId);
    res.status(201).json({ success: true, message: "Cause added successfully", data: selection });
  } catch (error) {
    next(error);
  }
};

const removeCause = async (req, res, next) => {
  try {
    const selection = await preferenceService.removeCause(req.user.userId, req.params.causeId);
    res.status(200).json({ success: true, message: "Cause removed successfully", data: selection });
  } catch (error) {
    next(error);
  }
};

const addSkill = async (req, res, next) => {
  try {
    const selection = await preferenceService.addSkill(
      req.user.userId,
      req.body.skillId,
      req.body.proficiencyLevel
    );
    res.status(201).json({ success: true, message: "Skill added successfully", data: selection });
  } catch (error) {
    next(error);
  }
};

const updateSkill = async (req, res, next) => {
  try {
    const selection = await preferenceService.updateSkillProficiency(
      req.user.userId,
      req.params.skillId,
      req.body.proficiencyLevel
    );
    res.status(200).json({ success: true, message: "Skill proficiency updated successfully", data: selection });
  } catch (error) {
    next(error);
  }
};

const removeSkill = async (req, res, next) => {
  try {
    const selection = await preferenceService.removeSkill(req.user.userId, req.params.skillId);
    res.status(200).json({ success: true, message: "Skill removed successfully", data: selection });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getPreferences,
  addCause,
  removeCause,
  addSkill,
  updateSkill,
  removeSkill,
};

const skillService = require("../services/skill.service");

const list = async (req, res, next) => {
  try {
    const skills = await skillService.listAvailableSkills();

    res.status(200).json({
      success: true,
      message: "Skills retrieved successfully",
      data: skills,
    });
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const skill = await skillService.getAvailableSkill(req.params.id);

    res.status(200).json({
      success: true,
      message: "Skill retrieved successfully",
      data: skill,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  getById,
};

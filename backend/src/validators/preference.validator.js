const { body, param } = require("express-validator");

const rejectUnknownFields = (allowedFields) => body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }

  const unknownFields = Object.keys(value).filter((field) => !allowedFields.includes(field));
  if (unknownFields.length) {
    throw new Error(`Unsupported field(s): ${unknownFields.join(", ")}`);
  }

  return true;
});

const addCauseValidator = [
  rejectUnknownFields(["causeId"]),
  body("causeId").isUUID().withMessage("Cause ID must be a valid UUID"),
];

const causeIdParamValidator = [
  param("causeId").isUUID().withMessage("Cause ID must be a valid UUID"),
];

const addSkillValidator = [
  rejectUnknownFields(["skillId", "proficiencyLevel"]),
  body("skillId").isUUID().withMessage("Skill ID must be a valid UUID"),
  body("proficiencyLevel")
    .optional()
    .isIn(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"])
    .withMessage("Proficiency level must be BEGINNER, INTERMEDIATE, ADVANCED, or EXPERT"),
];

const skillParamValidator = [
  param("skillId").isUUID().withMessage("Skill ID must be a valid UUID"),
];

const updateSkillValidator = [
  rejectUnknownFields(["proficiencyLevel"]),
  body("proficiencyLevel")
    .isIn(["BEGINNER", "INTERMEDIATE", "ADVANCED", "EXPERT"])
    .withMessage("Proficiency level must be BEGINNER, INTERMEDIATE, ADVANCED, or EXPERT"),
];

module.exports = {
  addCauseValidator,
  causeIdParamValidator,
  addSkillValidator,
  skillParamValidator,
  updateSkillValidator,
};

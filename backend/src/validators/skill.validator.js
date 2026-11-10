const { param } = require("express-validator");

const skillIdValidator = [
  param("id").isUUID().withMessage("Skill ID must be a valid UUID"),
];

module.exports = {
  skillIdValidator,
};

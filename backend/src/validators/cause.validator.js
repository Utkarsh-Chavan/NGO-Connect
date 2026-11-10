const { param } = require("express-validator");

const causeIdValidator = [
  param("id").isUUID().withMessage("Cause ID must be a valid UUID"),
];

module.exports = {
  causeIdValidator,
};

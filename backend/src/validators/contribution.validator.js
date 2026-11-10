const { body, param } = require("express-validator");

const allowedContributionFields = ["contributionType", "description", "quantity"];

const rejectUnknownFields = body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }

  const unexpectedFields = Object.keys(value).filter((field) => !allowedContributionFields.includes(field));
  if (unexpectedFields.length) throw new Error(`Unsupported field(s): ${unexpectedFields.join(", ")}`);
  return true;
});

const needIdValidator = [param("needId").isUUID().withMessage("Need ID must be a valid UUID")];
const contributionPathValidator = [
  ...needIdValidator,
  param("contributionId").isUUID().withMessage("Contribution ID must be a valid UUID"),
];

const createContributionValidator = [
  rejectUnknownFields,
  body("contributionType").isIn(["MATERIAL", "SKILL"])
    .withMessage("Contribution type must be MATERIAL or SKILL; money support is arranged directly with the NGO"),
  body("description").optional({ nullable: true }).isString()
    .withMessage("Description must be a string"),
  body("quantity").optional({ nullable: true }).isInt({ min: 1, max: 2147483647 })
    .withMessage("Quantity must be a positive PostgreSQL integer").toInt(),
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return true;
    const type = value.contributionType;
    const hasQuantity = value.quantity !== undefined && value.quantity !== null;
    if (type === "MATERIAL" && !hasQuantity) {
      throw new Error("MATERIAL contributions require quantity");
    }
    if (type === "SKILL" && hasQuantity) {
      throw new Error("SKILL contributions accept description only until a unit is defined");
    }
    return true;
  }),
];

const updateContributionStatusValidator = [
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    const unexpectedFields = Object.keys(value).filter((field) => field !== "status");
    if (unexpectedFields.length) throw new Error(`Unsupported field(s): ${unexpectedFields.join(", ")}`);
    return true;
  }),
  body("status").isIn(["ACCEPTED", "REJECTED", "IN_PROGRESS", "COMPLETED"])
    .withMessage("Status must be ACCEPTED, REJECTED, IN_PROGRESS, or COMPLETED"),
];

module.exports = {
  needIdValidator,
  contributionPathValidator,
  createContributionValidator,
  updateContributionStatusValidator,
};

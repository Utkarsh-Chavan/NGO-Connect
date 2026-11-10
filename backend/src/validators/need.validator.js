const { body, param, query } = require("express-validator");

const allowedBodyFields = [
  "causeId", "title", "description", "contributionType", "location",
  "availability", "quantityRequired", "priority", "deadline", "status",
];

const rejectUnknownFields = body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }

  const unknownFields = Object.keys(value).filter((field) => !allowedBodyFields.includes(field));
  if (unknownFields.length) throw new Error(`Unsupported field(s): ${unknownFields.join(", ")}`);
  return true;
});

const needIdValidator = [
  param("id").isUUID().withMessage("Need ID must be a valid UUID"),
];

const listNeedsValidator = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt()
    .withMessage("Limit must be an integer between 1 and 100"),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).toInt()
    .withMessage("Offset must be a nonnegative integer"),
  query("search").optional().isString().withMessage("Search must be a string").bail()
    .trim().isLength({ max: 100 }).withMessage("Search must be at most 100 characters")
    .customSanitizer((value) => value || null),
  query("causeId").optional().isString().withMessage("Cause must be a valid UUID").bail()
    .trim().toLowerCase().isUUID().withMessage("Cause must be a valid UUID"),
  query("contributionType").optional().isString().withMessage("Contribution type is invalid").bail()
    .trim().toUpperCase().isIn(["VOLUNTEER", "MATERIAL", "MONEY", "SKILL"])
    .withMessage("Contribution type must be VOLUNTEER, MATERIAL, MONEY, or SKILL"),
  query("location").optional().isString().withMessage("Location must be a string").bail()
    .trim().isLength({ max: 100 }).withMessage("Location must be at most 100 characters")
    .customSanitizer((value) => value || null),
];

const needBodyValidators = [
  rejectUnknownFields,
  body("causeId").isUUID().withMessage("Cause ID must be a valid UUID"),
  body("title").isString().withMessage("Title must be a string").bail()
    .trim().notEmpty().withMessage("Title is required")
    .isLength({ max: 150 }).withMessage("Title must be at most 150 characters"),
  body("description").isString().withMessage("Description must be a string").bail()
    .trim().notEmpty().withMessage("Description is required"),
  body("contributionType").isIn(["VOLUNTEER", "MATERIAL", "MONEY", "SKILL"])
    .withMessage("Contribution type must be VOLUNTEER, MATERIAL, MONEY, or SKILL"),
  body("location").optional({ nullable: true }).isString()
    .withMessage("Location must be a string")
    .bail().isLength({ max: 150 }).withMessage("Location must be at most 150 characters"),
  body("availability").optional({ nullable: true }).isObject()
    .withMessage("Availability must be a JSON object"),
  body("quantityRequired").optional({ nullable: true }).isInt({ min: 1 }).toInt()
    .withMessage("Quantity required must be a positive integer"),
  body("priority").optional().isIn(["LOW", "MEDIUM", "HIGH", "URGENT"])
    .withMessage("Priority must be LOW, MEDIUM, HIGH, or URGENT"),
  body("deadline").optional({ nullable: true }).isISO8601({ strict: true, strictSeparator: true })
    .bail().custom((value) => /(?:Z|[+-]\d{2}:\d{2})$/i.test(value))
    .withMessage("Deadline must be an ISO 8601 date-time with an explicit timezone"),
  body("status").optional().isIn(["DRAFT", "ACTIVE"])
    .withMessage("Status must be DRAFT or ACTIVE"),
];

const createNeedValidator = [...needBodyValidators];
const updateNeedValidator = [
  ...needBodyValidators,
  body("causeId").exists().withMessage("Cause ID is required"),
  body("title").exists().withMessage("Title is required"),
  body("description").exists().withMessage("Description is required"),
  body("contributionType").exists().withMessage("Contribution type is required"),
  body("priority").exists().withMessage("Priority is required"),
  body("status").exists().withMessage("Status is required"),
];

module.exports = {
  needIdValidator,
  listNeedsValidator,
  createNeedValidator,
  updateNeedValidator,
};

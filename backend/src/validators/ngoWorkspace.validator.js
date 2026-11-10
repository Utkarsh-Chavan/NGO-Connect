const { param, query } = require("express-validator");

const pagination = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt().withMessage("Limit must be between 1 and 100"),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).toInt().withMessage("Offset must be nonnegative"),
];

const needIdValidator = [param("needId").isUUID().withMessage("Need ID must be a valid UUID")];

const listNeedsValidator = [
  ...pagination,
  query("status").optional().isIn(["DRAFT", "ACTIVE", "PARTIALLY_FULFILLED", "COMPLETED", "FULFILLED", "EXPIRED", "CLOSED"])
    .withMessage("Unsupported need status"),
  query("contributionType").optional().isIn(["VOLUNTEER", "MATERIAL", "MONEY", "SKILL"])
    .withMessage("Unsupported contribution type"),
  query("search").optional().isString().trim().isLength({ max: 100 }).withMessage("Search must be 100 characters or fewer"),
];

const listResponsesValidator = [
  ...pagination,
  query("status").optional().isIn(["APPLIED", "PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED", "REJECTED"])
    .withMessage("Unsupported response status"),
  query("contributionType").optional().isIn(["VOLUNTEER", "MATERIAL", "MONEY", "SKILL"])
    .withMessage("Unsupported contribution type"),
  query("needId").optional().isUUID().withMessage("Need ID must be a valid UUID"),
  query("search").optional().isString().trim().isLength({ max: 100 }).withMessage("Search must be 100 characters or fewer"),
];

module.exports = { needIdValidator, listNeedsValidator, listResponsesValidator };

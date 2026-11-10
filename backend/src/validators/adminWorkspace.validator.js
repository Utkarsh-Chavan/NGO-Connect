const { body, param, query } = require("express-validator");

const pagination = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt(),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).toInt(),
  query("search").optional().isString().trim().isLength({ max: 100 }),
];
const exactBody = (allowed) => body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Request body must be a JSON object");
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) throw new Error(`Unsupported field(s): ${extras.join(", ")}`);
  return true;
});

const userList = [...pagination,
  query("role").optional().isIn(["INDIVIDUAL", "NGO", "ADMIN"]),
  query("status").optional().isIn(["ACTIVE", "SUSPENDED"]),
];
const needList = [...pagination,
  query("status").optional().isIn(["DRAFT", "ACTIVE", "PARTIALLY_FULFILLED", "COMPLETED", "FULFILLED", "EXPIRED", "CLOSED"]),
  query("moderationStatus").optional().isIn(["VISIBLE", "HIDDEN"]),
  query("contributionType").optional().isIn(["VOLUNTEER", "MATERIAL", "MONEY", "SKILL"]),
];
const userId = [param("userId").isUUID()];
const needId = [param("needId").isUUID()];
const userStatus = [...userId, exactBody(["suspended", "reason"]),
  body("suspended").isBoolean().toBoolean(),
  body("reason").isString().trim().notEmpty().isLength({ max: 2000 }),
];
const needModeration = [...needId, exactBody(["hidden", "reason"]),
  body("hidden").isBoolean().toBoolean(),
  body("reason").isString().trim().notEmpty().isLength({ max: 2000 }),
];

module.exports = { userList, needList, userId, needId, userStatus, needModeration };

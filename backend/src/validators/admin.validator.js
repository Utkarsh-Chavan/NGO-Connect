const { body, param, query } = require("express-validator");

const listPendingNgosValidator = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt()
    .withMessage("Limit must be an integer between 1 and 100"),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).toInt()
    .withMessage("Offset must be a nonnegative integer"),
];

const verifyNgoValidator = [
  param("ngoId").isUUID().withMessage("NGO ID must be a valid UUID"),
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    const allowedFields = new Set(["verificationStatus", "message"]);
    const unexpectedFields = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unexpectedFields.length) {
      throw new Error(`Unsupported field(s): ${unexpectedFields.join(", ")}`);
    }
    return true;
  }),
  body("verificationStatus")
    .isIn(["APPROVED", "REJECTED"])
    .withMessage("Verification status must be APPROVED or REJECTED"),
  body("message")
    .optional({ nullable: true })
    .isString().withMessage("Message must be a string")
    .bail()
    .trim()
    .isLength({ max: 5000 }).withMessage("Message must not exceed 5000 characters"),
  body().custom((value) => {
    if (value?.verificationStatus === "REJECTED"
        && (typeof value.message !== "string" || !value.message.trim())) {
      throw new Error("A meaningful rejection message is required");
    }
    return true;
  }),
];

module.exports = { listPendingNgosValidator, verifyNgoValidator };

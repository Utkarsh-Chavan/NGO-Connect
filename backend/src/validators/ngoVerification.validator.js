const { body, param } = require("express-validator");

const adminNgoIdValidator = [
  param("ngoId").isUUID().withMessage("NGO ID must be a valid UUID"),
];

const adminDocumentParamValidator = [
  ...adminNgoIdValidator,
  param("documentId").isUUID().withMessage("Document ID must be a valid UUID"),
];

const requestInformationValidator = [
  ...adminNgoIdValidator,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    const unexpected = Object.keys(value).filter((field) => field !== "message");
    if (unexpected.length) throw new Error(`Unsupported field(s): ${unexpected.join(", ")}`);
    return true;
  }),
  body("message").isString().withMessage("A message is required")
    .bail().trim().notEmpty().withMessage("A meaningful message is required")
    .isLength({ max: 5000 }).withMessage("Message must not exceed 5000 characters"),
];

const adminDecisionMessageValidator = [
  ...adminNgoIdValidator,
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    const unexpected = Object.keys(value).filter((field) => field !== "message");
    if (unexpected.length) throw new Error(`Unsupported field(s): ${unexpected.join(", ")}`);
    return true;
  }),
  body("message").isString().withMessage("A message is required")
    .bail().trim().notEmpty().withMessage("A meaningful message is required")
    .isLength({ max: 5000 }).withMessage("Message must not exceed 5000 characters"),
];

const adminApprovalValidator = [
  ...adminNgoIdValidator,
  body().custom((value) => {
    if (value === undefined) return true;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }
    const unexpected = Object.keys(value).filter((field) => field !== "message");
    if (unexpected.length) throw new Error(`Unsupported field(s): ${unexpected.join(", ")}`);
    return true;
  }),
  body("message").optional({ nullable: true }).isString().withMessage("Message must be a string")
    .bail().trim().isLength({ max: 5000 }).withMessage("Message must not exceed 5000 characters"),
];

module.exports = {
  adminNgoIdValidator,
  adminDocumentParamValidator,
  requestInformationValidator,
  adminDecisionMessageValidator,
  adminApprovalValidator,
};

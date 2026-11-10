const { body, param } = require("express-validator");

const rejectUnknownFields = (allowedFields) => body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }

  const unexpectedFields = Object.keys(value).filter((field) => !allowedFields.includes(field));
  if (unexpectedFields.length) throw new Error(`Unsupported field(s): ${unexpectedFields.join(", ")}`);
  return true;
});

const needIdValidator = [param("needId").isUUID().withMessage("Need ID must be a valid UUID")];

const applicationPathValidator = [
  ...needIdValidator,
  param("applicationId").isUUID().withMessage("Application ID must be a valid UUID"),
];

const createApplicationValidator = [
  rejectUnknownFields(["message"]),
  body("message").optional({ nullable: true }).isString().withMessage("Message must be a string"),
];

const reviewApplicationValidator = [
  rejectUnknownFields(["status"]),
  body("status").isIn(["ACCEPTED", "REJECTED", "COMPLETED"])
    .withMessage("Status must be ACCEPTED, REJECTED, or COMPLETED"),
];

module.exports = {
  needIdValidator,
  applicationPathValidator,
  createApplicationValidator,
  reviewApplicationValidator,
};

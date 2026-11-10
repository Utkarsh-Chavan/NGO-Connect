const { body } = require("express-validator");

const allowedFields = ["name", "phone", "city", "availability"];
const rejectUnknownFields = body().custom((value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Request body must be a JSON object");
  }
  const unknown = Object.keys(value).filter((field) => !allowedFields.includes(field));
  if (unknown.length) throw new Error(`Unsupported field(s): ${unknown.join(", ")}`);
  return true;
});

const updateIndividualProfileValidator = [
  rejectUnknownFields,
  body("name").trim().notEmpty().withMessage("Name is required")
    .isLength({ max: 100 }).withMessage("Name must be 100 characters or fewer"),
  body("phone").exists().withMessage("Phone must be provided; use null to clear it")
    .bail().custom((value) => value === null || (typeof value === "string" && value.length <= 20))
    .withMessage("Phone must be null or 20 characters or fewer"),
  body("city").exists().withMessage("City must be provided; use null to clear it")
    .bail().custom((value) => value === null || (typeof value === "string" && value.length <= 100))
    .withMessage("City must be null or 100 characters or fewer"),
  body("availability").exists().withMessage("Availability must be provided; use null to clear it")
    .bail().custom((value) => value === null || (typeof value === "object" && !Array.isArray(value)))
    .withMessage("Availability must be null or a JSON object"),
];

module.exports = { updateIndividualProfileValidator };

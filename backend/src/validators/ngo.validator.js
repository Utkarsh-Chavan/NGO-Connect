const { body } = require("express-validator");

const allowedFields = new Set([
  "name", "description", "email", "phone", "address", "city", "websiteUrl",
]);

const normalizeWebsiteUrl = (value) => {
  const trimmed = value.trim();
  if (!trimmed) return null;
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("Website URL must be a valid absolute URL");
  }
  if (!["http:", "https:"].includes(parsed.protocol)
      || !parsed.hostname
      || parsed.username
      || parsed.password) {
    throw new Error("Website URL must use HTTP or HTTPS and must not contain credentials");
  }
  const normalized = parsed.toString();
  if (normalized.length > 255) throw new Error("Website URL must be at most 255 characters");
  return normalized;
};

const createNgoValidator = [
  body().custom((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Request body must be a JSON object");
    }

    const unexpectedFields = Object.keys(value).filter((key) => !allowedFields.has(key));
    if (unexpectedFields.length) {
      throw new Error(`Unsupported field(s): ${unexpectedFields.join(", ")}`);
    }

    return true;
  }),
  body("name")
    .isString().withMessage("Name must be a string")
    .bail().trim().notEmpty().withMessage("Name is required")
    .isLength({ max: 150 }).withMessage("Name must be at most 150 characters"),
  body("description")
    .optional({ nullable: true })
    .isString().withMessage("Description must be a string"),
  body("email")
    .isString().withMessage("Email must be a string")
    .bail().trim().notEmpty().withMessage("Email is required")
    .isLength({ max: 150 }).withMessage("Email must be at most 150 characters")
    .isEmail().withMessage("Email must be valid"),
  body("phone")
    .optional({ nullable: true })
    .isString().withMessage("Phone must be a string")
    .bail().isLength({ max: 20 }).withMessage("Phone must be at most 20 characters"),
  body("address")
    .optional({ nullable: true })
    .isString().withMessage("Address must be a string"),
  body("city")
    .isString().withMessage("City must be a string")
    .bail().trim().notEmpty().withMessage("City is required")
    .isLength({ max: 100 }).withMessage("City must be at most 100 characters"),
  body("websiteUrl")
    .optional({ nullable: true })
    .isString().withMessage("Website URL must be a string")
    .bail()
    .custom((value, { req }) => {
      try {
        req.body.websiteUrl = normalizeWebsiteUrl(value);
        return true;
      } catch (error) {
        throw new Error(error.message);
      }
    }),
];

const updateNgoValidator = [...createNgoValidator];

module.exports = {
  createNgoValidator,
  updateNgoValidator,
  normalizeWebsiteUrl,
};

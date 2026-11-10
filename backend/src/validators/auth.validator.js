const { body } = require("express-validator");

const verificationTokenValidator = [
  body("token")
    .isString().withMessage("Verification token is required")
    .bail()
    .matches(/^[A-Za-z0-9_-]{43}$/)
    .withMessage("Verification token is invalid"),
];

const resendVerificationValidator = [
  body("email")
    .isString().withMessage("Email must be a string")
    .bail()
    .trim()
    .notEmpty().withMessage("Email is required")
    .isEmail().withMessage("Valid email is required")
    .normalizeEmail(),
];

const registerValidator = [
  body("name")
    .isString()
    .withMessage("Name must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Name is required")
    .isLength({ max: 100 })
    .withMessage("Name must not exceed 100 characters"),

  body("email")
    .isString()
    .withMessage("Email must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),

  body("password")
    .isString()
    .withMessage("Password must be a string")
    .isLength({ min: 8 })
    .withMessage("Password must be at least 8 characters long"),

  body("role")
    .optional()
    .isIn(["INDIVIDUAL", "NGO"])
    .withMessage("Role must be either INDIVIDUAL or NGO"),

  body("phone")
    .optional()
    .isString()
    .withMessage("Phone must be a string")
    .bail()
    .isLength({ max: 20 })
    .withMessage("Phone must not exceed 20 characters"),

  body("city")
    .optional()
    .isString()
    .withMessage("City must be a string")
    .bail()
    .trim()
    .isLength({ max: 100 })
    .withMessage("City must not exceed 100 characters"),

  body("availability")
    .optional({ nullable: true })
    .isObject()
    .withMessage("Availability must be a valid JSON object"),
];

const loginValidator = [
  body("email")
    .isString()
    .withMessage("Email must be a string")
    .bail()
    .trim()
    .notEmpty()
    .withMessage("Email is required")
    .isEmail()
    .withMessage("Valid email is required")
    .normalizeEmail(),

  body("password")
    .isString()
    .withMessage("Password is required")
    .notEmpty()
    .withMessage("Password is required"),
];

module.exports = {
  registerValidator,
  loginValidator,
  verificationTokenValidator,
  resendVerificationValidator,
};

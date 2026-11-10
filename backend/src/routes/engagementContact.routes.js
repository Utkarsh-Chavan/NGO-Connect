const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const controller = require("../controllers/engagementContact.controller");
const { param } = require("express-validator");

const uuidParam = (field, label) => [
  param(field).isUUID().withMessage(`${label} must be a valid UUID`),
];
const supportedRoles = [authenticate, authorize("INDIVIDUAL", "NGO")];
const router = express.Router();

router.get(
  "/applications/:applicationId/contact",
  ...supportedRoles,
  uuidParam("applicationId", "Application ID"),
  validateRequest,
  controller.getApplicationContact
);
router.get(
  "/contributions/:contributionId/contact",
  ...supportedRoles,
  uuidParam("contributionId", "Contribution ID"),
  validateRequest,
  controller.getContributionContact
);

module.exports = router;

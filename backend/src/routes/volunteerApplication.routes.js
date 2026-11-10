const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const applicationController = require("../controllers/volunteerApplication.controller");
const {
  needIdValidator,
  applicationPathValidator,
  createApplicationValidator,
  reviewApplicationValidator,
} = require("../validators/volunteerApplication.validator");

const router = express.Router();

router.get(
  "/users/me/applications",
  authenticate,
  authorize("INDIVIDUAL"),
  applicationController.listForUser
);
router.post(
  "/needs/:needId/applications",
  authenticate,
  authorize("INDIVIDUAL"),
  needIdValidator,
  createApplicationValidator,
  validateRequest,
  applicationController.create
);
router.get(
  "/needs/:needId/applications",
  authenticate,
  authorize("NGO"),
  needIdValidator,
  validateRequest,
  applicationController.listForNeed
);
router.put(
  "/needs/:needId/applications/:applicationId",
  authenticate,
  authorize("NGO"),
  applicationPathValidator,
  reviewApplicationValidator,
  validateRequest,
  applicationController.review
);

module.exports = router;

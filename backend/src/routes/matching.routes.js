const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const matchingController = require("../controllers/matching.controller");
const { recommendationsValidator } = require("../validators/matching.validator");

const router = express.Router();

router.get(
  "/recommendations",
  authenticate,
  authorize("INDIVIDUAL"),
  recommendationsValidator,
  validateRequest,
  matchingController.getRecommendations
);

module.exports = router;

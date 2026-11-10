const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const contributionController = require("../controllers/contribution.controller");
const {
  needIdValidator,
  contributionPathValidator,
  createContributionValidator,
  updateContributionStatusValidator,
} = require("../validators/contribution.validator");

const router = express.Router();

const rejectMoneyContribution = (req, res, next) => {
  if (req.body?.contributionType !== "MONEY") return next();
  const error = new Error("Money support is arranged directly with the NGO and cannot be submitted on NGO Connect");
  error.statusCode = 400;
  return next(error);
};

router.get(
  "/users/me/contributions",
  authenticate,
  authorize("INDIVIDUAL"),
  contributionController.listForUser
);
router.post(
  "/needs/:needId/contributions",
  authenticate,
  authorize("INDIVIDUAL"),
  needIdValidator,
  rejectMoneyContribution,
  createContributionValidator,
  validateRequest,
  contributionController.create
);
router.get(
  "/needs/:needId/contributions",
  authenticate,
  authorize("NGO"),
  needIdValidator,
  validateRequest,
  contributionController.listForNeed
);
router.put(
  "/needs/:needId/contributions/:contributionId/status",
  authenticate,
  authorize("NGO"),
  contributionPathValidator,
  updateContributionStatusValidator,
  validateRequest,
  contributionController.updateStatus
);

module.exports = router;

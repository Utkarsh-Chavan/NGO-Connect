const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const ngoController = require("../controllers/ngo.controller");
const ngoVerificationController = require("../controllers/ngoVerification.controller");
const workspaceController = require("../controllers/ngoWorkspace.controller");
const { parseNgoVerificationUpload } = require("../middleware/ngoVerificationUpload.middleware");
const { createNgoValidator, updateNgoValidator } = require("../validators/ngo.validator");
const { needIdValidator, listNeedsValidator, listResponsesValidator } = require("../validators/ngoWorkspace.validator");

const router = express.Router();

router.post(
  "/me",
  authenticate,
  authorize("NGO"),
  createNgoValidator,
  validateRequest,
  ngoController.createMe
);

router.get("/me", authenticate, authorize("NGO"), ngoController.getMe);

router.put(
  "/me",
  authenticate,
  authorize("NGO"),
  updateNgoValidator,
  validateRequest,
  ngoController.updateMe
);

router.get("/me/dashboard", authenticate, authorize("NGO"), workspaceController.dashboard);
router.get("/me/needs", authenticate, authorize("NGO"), listNeedsValidator, validateRequest, workspaceController.listNeeds);
router.post("/me/needs/:needId/close", authenticate, authorize("NGO"), needIdValidator, validateRequest, workspaceController.closeNeed);
router.get("/me/needs/:needId", authenticate, authorize("NGO"), needIdValidator, validateRequest, workspaceController.getNeed);
router.get("/me/responses", authenticate, authorize("NGO"), listResponsesValidator, validateRequest, workspaceController.listResponses);

router.post(
  "/me/verification/submissions",
  authenticate,
  authorize("NGO"),
  parseNgoVerificationUpload,
  ngoVerificationController.submitMe
);

router.get(
  "/me/verification",
  authenticate,
  authorize("NGO"),
  ngoVerificationController.getMe
);

module.exports = router;

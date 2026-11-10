const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const ngoController = require("../controllers/ngo.controller");
const ngoVerificationController = require("../controllers/ngoVerification.controller");
const adminWorkspaceController = require("../controllers/adminWorkspace.controller");
const workspaceValidators = require("../validators/adminWorkspace.validator");
const { listPendingNgosValidator, verifyNgoValidator } = require("../validators/admin.validator");
const {
  adminNgoIdValidator,
  adminDocumentParamValidator,
  requestInformationValidator,
  adminDecisionMessageValidator,
  adminApprovalValidator,
} = require("../validators/ngoVerification.validator");

const router = express.Router();
const requireAdmin = [authenticate, authorize("ADMIN")];

router.get("/dashboard", ...requireAdmin, adminWorkspaceController.dashboard);
router.get("/analytics", ...requireAdmin, adminWorkspaceController.analytics);
router.get("/users", ...requireAdmin, workspaceValidators.userList, validateRequest, adminWorkspaceController.listUsers);
router.get("/users/:userId", ...requireAdmin, workspaceValidators.userId, validateRequest, adminWorkspaceController.getUser);
router.patch("/users/:userId/status", ...requireAdmin, workspaceValidators.userStatus, validateRequest, adminWorkspaceController.updateUserStatus);
router.get("/needs", ...requireAdmin, workspaceValidators.needList, validateRequest, adminWorkspaceController.listNeeds);
router.get("/needs/:needId", ...requireAdmin, workspaceValidators.needId, validateRequest, adminWorkspaceController.getNeed);
router.patch("/needs/:needId/moderation", ...requireAdmin, workspaceValidators.needModeration, validateRequest, adminWorkspaceController.updateNeedModeration);

router.get(
  "/ngos/pending",
  ...requireAdmin,
  listPendingNgosValidator,
  validateRequest,
  ngoController.listPending
);

router.get(
  "/ngos/:ngoId/verification",
  ...requireAdmin,
  adminNgoIdValidator,
  validateRequest,
  ngoVerificationController.getAdminVerification
);

router.get(
  "/ngos/:ngoId/verification/documents/:documentId",
  ...requireAdmin,
  adminDocumentParamValidator,
  validateRequest,
  ngoVerificationController.getAdminDocument
);

router.post(
  "/ngos/:ngoId/verification/approve",
  ...requireAdmin,
  adminApprovalValidator,
  validateRequest,
  ngoVerificationController.approve
);

router.post(
  "/ngos/:ngoId/verification/reject",
  ...requireAdmin,
  adminDecisionMessageValidator,
  validateRequest,
  ngoVerificationController.reject
);

router.post(
  "/ngos/:ngoId/verification/request-info",
  ...requireAdmin,
  requestInformationValidator,
  validateRequest,
  ngoVerificationController.requestInfo
);

router.put(
  "/ngos/:ngoId/verification",
  ...requireAdmin,
  verifyNgoValidator,
  validateRequest,
  ngoController.updateVerification
);

module.exports = router;

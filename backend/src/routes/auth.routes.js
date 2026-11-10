const express = require("express");

const {
  registerValidator,
  loginValidator,
  verificationTokenValidator,
  resendVerificationValidator,
} = require("../validators/auth.validator");
const validateRequest = require("../middleware/validation.middleware");
const authController = require("../controllers/auth.controller");

const router = express.Router();

router.post(
  "/register",
  registerValidator,
  validateRequest,
  authController.register
);

router.post(
  "/login",
  loginValidator,
  validateRequest,
  authController.login
);

router.post(
  "/verify-email",
  verificationTokenValidator,
  validateRequest,
  authController.verifyEmail
);

router.post(
  "/resend-verification",
  resendVerificationValidator,
  validateRequest,
  authController.resendVerification
);

module.exports = router;

const authService = require("../services/auth.service");

const register = async (req, res, next) => {
  try {
    const {
      name,
      email,
      password,
      role = "INDIVIDUAL",
      phone,
      city,
      availability,
    } = req.body;

    const registration = await authService.registerUser({
      name,
      email,
      password,
      role,
      phone,
      city,
      availability,
    });

    if (!registration.emailSent) {
      return res.status(503).json({
        success: false,
        code: "EMAIL_DELIVERY_FAILED",
        message: "Your account was created, but the verification email could not be sent. Please request another verification email.",
        data: registration.user,
      });
    }

    return res.status(201).json({
      success: true,
      message: registration.deliveryMode === "development"
        ? "Account created. Open the verification link printed in the backend terminal before signing in."
        : "Account created. Check your email to verify it before signing in.",
      data: registration.user,
      deliveryMode: registration.deliveryMode,
    });
  } catch (error) {
    next(error);
  }
};

const verifyEmail = async (req, res, next) => {
  try {
    const result = await authService.verifyEmail(req.body.token);
    res.status(200).json({
      success: true,
      message: "Email verified successfully",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

const resendVerification = async (req, res, next) => {
  try {
    await authService.resendVerification(req.body.email);
    res.status(202).json({
      success: true,
      message: "If the account is eligible, verification delivery will be attempted.",
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    const result = await authService.loginUser({
      email,
      password,
    });

    res.status(200).json({
      success: true,
      message: "Login successful",
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  register,
  login,
  verifyEmail,
  resendVerification,
};

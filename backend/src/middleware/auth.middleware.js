const jwt = require("jsonwebtoken");
const userRepository = require("../repositories/user.repository");

const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        success: false,
        message: "Authentication token is required",
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET
    );

    const account = await userRepository.findAuthStatusById(decoded.userId);
    if (!account || account.is_suspended) {
      return res.status(401).json({ success: false, message: "Account is unavailable" });
    }
    req.user = decoded;

    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token",
    });
  }
};

module.exports = authenticate;

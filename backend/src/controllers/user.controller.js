const userService = require("../services/user.service");
const dashboardService = require("../services/individualDashboard.service");

const getMe = async (req, res, next) => {
  try {
    const user = await userService.getUserProfile(req.user.userId);

    res.status(200).json({
      success: true,
      message: "User profile retrieved successfully",
      data: user,
    });
  } catch (error) {
    next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const user = await userService.updateUserProfile(req.user.userId, {
      name: req.body.name,
      phone: req.body.phone ?? null,
      city: req.body.city ?? null,
      availability: req.body.availability ?? null,
    });
    res.status(200).json({ success: true, message: "User profile updated successfully", data: user });
  } catch (error) {
    next(error);
  }
};

const getDashboard = async (req, res, next) => {
  try {
    const dashboard = await dashboardService.getDashboard(req.user.userId);
    res.status(200).json({ success: true, message: "Individual dashboard retrieved successfully", data: dashboard });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getMe,
  updateMe,
  getDashboard,
};

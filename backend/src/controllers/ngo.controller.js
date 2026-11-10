const ngoService = require("../services/ngo.service");

const createMe = async (req, res, next) => {
  try {
    const ngo = await ngoService.createNgoProfile(req.user.userId, req.body);

    res.status(201).json({
      success: true,
      message: "NGO profile created successfully",
      data: ngo,
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const ngo = await ngoService.getNgoProfile(req.user.userId);

    res.status(200).json({
      success: true,
      message: "NGO profile retrieved successfully",
      data: ngo,
    });
  } catch (error) {
    next(error);
  }
};

const updateMe = async (req, res, next) => {
  try {
    const ngo = await ngoService.updateNgoProfile(req.user.userId, req.body);

    res.status(200).json({
      success: true,
      message: "NGO profile updated successfully",
      data: ngo,
    });
  } catch (error) {
    next(error);
  }
};

const listPending = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const ngos = await ngoService.listPendingNgoProfiles({ limit, offset });

    res.status(200).json({
      success: true,
      message: "Pending NGO profiles retrieved successfully",
      data: { items: ngos, pagination: { limit, offset } },
    });
  } catch (error) {
    next(error);
  }
};

const updateVerification = async (req, res, next) => {
  try {
    const ngo = await ngoService.verifyNgoProfile(
      req.params.ngoId,
      req.body.verificationStatus,
      req.user.userId,
      req.body.message
    );

    res.status(200).json({
      success: true,
      message: "NGO verification decision saved successfully",
      data: ngo,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createMe,
  getMe,
  updateMe,
  listPending,
  updateVerification,
};

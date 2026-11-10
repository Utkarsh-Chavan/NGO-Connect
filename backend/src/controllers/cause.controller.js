const causeService = require("../services/cause.service");

const list = async (req, res, next) => {
  try {
    const causes = await causeService.listAvailableCauses();

    res.status(200).json({
      success: true,
      message: "Causes retrieved successfully",
      data: causes,
    });
  } catch (error) {
    next(error);
  }
};

const getById = async (req, res, next) => {
  try {
    const cause = await causeService.getAvailableCause(req.params.id);

    res.status(200).json({
      success: true,
      message: "Cause retrieved successfully",
      data: cause,
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  list,
  getById,
};

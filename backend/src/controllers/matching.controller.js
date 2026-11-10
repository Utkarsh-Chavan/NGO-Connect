const matchingService = require("../services/matching.service");

const getRecommendations = async (req, res, next) => {
  try {
    const { limit = 20, offset = 0 } = req.query;
    const recommendations = await matchingService.getRecommendations(req.user.userId, { limit, offset });
    res.status(200).json({
      success: true,
      message: "Recommendations retrieved successfully",
      data: {
        items: recommendations.items,
        pagination: { limit, offset, total: recommendations.total },
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = { getRecommendations };

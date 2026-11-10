const dashboardRepository = require("../repositories/individualDashboard.repository");

const getDashboard = (userId) => dashboardRepository.findIndividualDashboard(userId);

module.exports = { getDashboard };

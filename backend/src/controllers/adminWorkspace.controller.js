const service = require("../services/adminWorkspace.service");

const wrap = (message, action, status = 200) => async (req, res, next) => {
  try {
    const data = await action(req);
    res.status(status).json({ success: true, message, data });
  } catch (error) { next(error); }
};

module.exports = {
  dashboard: wrap("Admin dashboard retrieved", () => service.getDashboard()),
  analytics: wrap("Admin analytics retrieved", () => service.getAnalytics()),
  listUsers: wrap("Users retrieved", (req) => service.listUsers({
    search: req.query.search, role: req.query.role, status: req.query.status,
    limit: req.query.limit ?? 20, offset: req.query.offset ?? 0,
  })),
  getUser: wrap("User retrieved", (req) => service.getUser(req.params.userId)),
  updateUserStatus: wrap("User status updated", (req) => service.setUserSuspension({
    userId: req.params.userId, adminUserId: req.user.userId,
    suspended: req.body.suspended, reason: req.body.reason,
  })),
  listNeeds: wrap("Needs retrieved", (req) => service.listNeeds({
    search: req.query.search, status: req.query.status,
    moderationStatus: req.query.moderationStatus,
    contributionType: req.query.contributionType,
    limit: req.query.limit ?? 20, offset: req.query.offset ?? 0,
  })),
  getNeed: wrap("Need retrieved", (req) => service.getNeed(req.params.needId)),
  updateNeedModeration: wrap("Need moderation status updated", (req) => service.setNeedModeration({
    needId: req.params.needId, adminUserId: req.user.userId,
    hidden: req.body.hidden, reason: req.body.reason,
  })),
};

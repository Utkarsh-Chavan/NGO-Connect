const workspaceService = require("../services/ngoWorkspace.service");

const listNeeds = async (req, res, next) => {
  try {
    const data = await workspaceService.listOwnedNeeds(req.user.userId, {
      limit: req.query.limit ?? 20, offset: req.query.offset ?? 0,
      status: req.query.status, contributionType: req.query.contributionType, search: req.query.search,
    });
    res.status(200).json({ success: true, message: "Your needs were retrieved", data });
  } catch (error) { next(error); }
};

const getNeed = async (req, res, next) => {
  try {
    const need = await workspaceService.getOwnedNeed(req.user.userId, req.params.needId);
    res.status(200).json({ success: true, message: "Your need was retrieved", data: need });
  } catch (error) { next(error); }
};

const closeNeed = async (req, res, next) => {
  try {
    const result = await workspaceService.closeOwnedNeed(req.user.userId, req.params.needId);
    res.status(200).json({ success: true, message: result.alreadyClosed ? "Need was already closed" : "Need closed successfully", data: result });
  } catch (error) { next(error); }
};

const listResponses = async (req, res, next) => {
  try {
    const data = await workspaceService.listResponses(req.user.userId, {
      limit: req.query.limit ?? 50, offset: req.query.offset ?? 0,
      status: req.query.status, contributionType: req.query.contributionType,
      needId: req.query.needId, search: req.query.search,
    });
    res.status(200).json({ success: true, message: "Responses received by your NGO were retrieved", data });
  } catch (error) { next(error); }
};

const dashboard = async (req, res, next) => {
  try {
    const data = await workspaceService.getDashboard(req.user.userId);
    res.status(200).json({ success: true, message: "NGO dashboard retrieved", data });
  } catch (error) { next(error); }
};

module.exports = { listNeeds, getNeed, closeNeed, listResponses, dashboard };

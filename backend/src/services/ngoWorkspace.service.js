const ngoRepository = require("../repositories/ngo.repository");
const workspaceRepository = require("../repositories/ngoWorkspace.repository");
const needService = require("./need.service");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getNgoId = async (userId) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);
  return ngo.ngo_id;
};

const listOwnedNeeds = async (userId, filters) => {
  const ngoId = await getNgoId(userId);
  const page = await workspaceRepository.findOwnedNeeds({ ngoId, ...filters });
  return { items: page.items, pagination: { limit: filters.limit, offset: filters.offset, total: page.total } };
};

const getOwnedNeed = (userId, needId) => needService.getOwnedNeed(userId, needId);

const listResponses = async (userId, filters) => {
  const ngoId = await getNgoId(userId);
  const page = await workspaceRepository.findResponses({ ngoId, ...filters });
  return { items: page.items, pagination: { limit: filters.limit, offset: filters.offset, total: page.total } };
};

const getDashboard = async (userId) => {
  const ngoId = await getNgoId(userId);
  return workspaceRepository.findDashboard(ngoId);
};

const closeOwnedNeed = async (userId, needId) => needService.closeOwnedNeed(userId, needId);

module.exports = { listOwnedNeeds, getOwnedNeed, closeOwnedNeed, listResponses, getDashboard };

const needRepository = require("../repositories/need.repository");
const needLifecycleRepository = require("../repositories/needLifecycle.repository");
const ngoRepository = require("../repositories/ngo.repository");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const getNgoForUser = async (userId) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);
  return ngo;
};

const ensureCanPublish = (ngo, status) => {
  if (status === "ACTIVE" && ngo.verification_status !== "APPROVED") {
    throw createError("NGO profile must be approved before publishing a need", 403);
  }
};

const createNeed = async (userId, input) => {
  const ngo = await getNgoForUser(userId);
  const status = input.status || "DRAFT";
  ensureCanPublish(ngo, status);

  const need = await needRepository.createNeed({
    ngoId: ngo.ngo_id,
    causeId: input.causeId,
    title: input.title,
    description: input.description,
    contributionType: input.contributionType,
    location: input.location ?? null,
    availability: input.availability ?? null,
    quantityRequired: input.quantityRequired ?? null,
    priority: input.priority || "MEDIUM",
    deadline: input.deadline ?? null,
    status,
    actorUserId: userId,
  });

  if (!need && input.deadline && Date.parse(input.deadline) <= Date.now()) {
    throw createError("Deadline must be in the future", 400);
  }
  if (!need) throw createError("Cause not found or inactive", 404);
  return need;
};

const listNeeds = async (filters) => {
  return needRepository.findPublicNeeds(filters);
};

const getNeed = async (needId) => {
  const need = await needRepository.findPublicNeedById(needId);
  if (!need) throw createError("Need not found", 404);
  return need;
};

const getOwnedNeed = async (userId, needId) => {
  const ngo = await getNgoForUser(userId);
  const need = await needRepository.findOwnedNeedById(needId, ngo.ngo_id);
  if (!need) throw createError("Need not found", 404);
  need.lifecycle_history = await needLifecycleRepository.findHistoryForNeed(needId);
  return need;
};

const updateNeed = async (userId, needId, input) => {
  const ngo = await getNgoForUser(userId);
  ensureCanPublish(ngo, input.status);

  try {
    const need = await needRepository.updateNeed({
      needId,
      ngoId: ngo.ngo_id,
      causeId: input.causeId,
      title: input.title,
      description: input.description,
      contributionType: input.contributionType,
      location: input.location ?? null,
      availability: input.availability ?? null,
      quantityRequired: input.quantityRequired ?? null,
      priority: input.priority,
      deadline: input.deadline ?? null,
      status: input.status,
      actorUserId: userId,
    });

    if (need?.kind === "OVER_COMMITTED") {
      throw createError("Quantity required cannot be less than fulfilled quantity plus accepted reservations", 409);
    }
    if (need?.kind === "RESERVATIONS_EXIST") {
      throw createError("A material need with accepted reservations or fulfilled quantity cannot change contribution type", 409);
    }
    if (need?.kind === "EXPIRED") throw createError("Expired needs cannot be edited or republished", 409);
    if (need?.kind === "NOT_EDITABLE") throw createError("Closed or completed needs cannot be edited", 409);
    if (!need) throw createError("Need not found, not owned by this NGO, not editable, or cause inactive", 404);
    return need;
  } catch (error) {
    if (error.code === "23514") {
      throw createError("Quantity required cannot be less than quantity already fulfilled", 400);
    }
    throw error;
  }
};

const closeOwnedNeed = async (userId, needId) => {
  const ngo = await getNgoForUser(userId);
  const result = await needLifecycleRepository.closeNeed({ needId, ngoId: ngo.ngo_id, actorUserId: userId });
  if (result.kind === "NOT_FOUND") throw createError("Need not found", 404);
  if (result.kind === "COMPLETED") throw createError("Completed needs cannot be closed", 409);
  return result;
};

module.exports = {
  createNeed,
  listNeeds,
  getNeed,
  getOwnedNeed,
  updateNeed,
  closeOwnedNeed,
};

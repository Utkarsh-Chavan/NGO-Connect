const contributionRepository = require("../repositories/contribution.repository");
const ngoRepository = require("../repositories/ngo.repository");
const needRepository = require("../repositories/need.repository");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const expectedStatusFor = (status) => ({
  ACCEPTED: "PENDING",
  REJECTED: "PENDING",
  IN_PROGRESS: "ACCEPTED",
  COMPLETED: "IN_PROGRESS",
}[status]);

const createContribution = async (userId, needId, input) => {
  if (input.contributionType === "MONEY") {
    throw createError("Money support is arranged directly with the NGO and cannot be submitted on NGO Connect", 400);
  }
  try {
    const contribution = await contributionRepository.createContribution({
      needId,
      userId,
      contributionType: input.contributionType,
      description: input.description ?? null,
      quantity: input.quantity ?? null,
      amount: null,
    });
    if (!contribution) throw createError("Need not found, unavailable, or contribution type does not match", 404);
    return contribution;
  } catch (error) {
    if (error.code === "23505"
        && error.constraint === "uq_contributions_one_non_rejected_per_user_need") {
      throw createError("You already have a non-rejected contribution for this need", 409);
    }
    throw error;
  }
};

const listNeedContributions = async (userId, needId) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);

  const need = await needRepository.findNeedOwnerById(needId);
  if (!need) throw createError("Need not found", 404);
  if (need.ngo_id !== ngo.ngo_id) throw createError("You do not own this need", 403);

  return contributionRepository.findContributionsForNeed(needId);
};

const listMyContributions = async (userId) =>
  contributionRepository.findContributionsForUser(userId);

const updateContributionStatus = async (userId, needId, contributionId, status) => {
  const expectedStatus = expectedStatusFor(status);
  if (!expectedStatus) throw createError("Unsupported contribution status", 400);

  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);

  const result = await contributionRepository.transitionContribution({
    needId,
    contributionId,
    userId,
    ngoId: ngo.ngo_id,
    expectedStatus,
    status,
  });

  if (result.kind === "NOT_FOUND") throw createError("Need or contribution not found", 404);
  if (result.kind === "FORBIDDEN") throw createError("You do not own this need", 403);
  if (result.kind === "CONFLICT") throw createError("Invalid contribution status transition", 409);
  if (result.kind === "OVER_FULFILLED") {
    throw createError("Completing this contribution would exceed the need quantity", 409);
  }
  if (result.kind === "OVER_COMMITTED") {
    throw createError("Accepting this contribution would exceed the remaining need quantity", 409);
  }
  if (result.kind === "EXTERNAL_SUPPORT_ONLY") {
    throw createError("Historical money records are read-only; money support is arranged directly with the NGO", 409);
  }
  if (result.kind === "NOT_FULFILLABLE") {
    throw createError("Need cannot accept additional material fulfillment", 409);
  }

  return result.data;
};

module.exports = {
  createContribution,
  listNeedContributions,
  listMyContributions,
  updateContributionStatus,
};

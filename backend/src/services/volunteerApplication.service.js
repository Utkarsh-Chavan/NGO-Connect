const applicationRepository = require("../repositories/volunteerApplication.repository");
const ngoRepository = require("../repositories/ngo.repository");
const needRepository = require("../repositories/need.repository");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const expectedStatusFor = (targetStatus) => {
  if (targetStatus === "ACCEPTED" || targetStatus === "REJECTED") return "APPLIED";
  if (targetStatus === "COMPLETED") return "ACCEPTED";
  return null;
};

const applyToNeed = async (userId, needId, message = null) => {
  const contributionType = await applicationRepository.findNeedContributionType(needId);
  if (contributionType && contributionType !== "VOLUNTEER") {
    throw createError("Volunteer applications are only accepted for VOLUNTEER needs", 400);
  }

  try {
    const application = await applicationRepository.createApplication({ needId, userId, message });
    if (!application) throw createError("Need not found or unavailable for applications", 404);
    return application;
  } catch (error) {
    if (error.code === "23505" && error.constraint === "uq_volunteer_application") {
      throw createError("An application for this need already exists", 409);
    }
    throw error;
  }
};

const getApplicationsForUser = async (userId) =>
  applicationRepository.findApplicationsForUser(userId);

const getApplicationsForNeed = async (userId, needId) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);

  const need = await needRepository.findNeedOwnerById(needId);
  if (!need) throw createError("Need not found", 404);
  if (need.ngo_id !== ngo.ngo_id) throw createError("You do not own this need", 403);

  return applicationRepository.findApplicationsForNeed(needId);
};

const reviewApplication = async (userId, needId, applicationId, targetStatus) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);
  if (!ngo) throw createError("NGO profile not found", 404);

  const context = await applicationRepository.findApplicationReviewContext({ needId, applicationId });
  if (!context) throw createError("Volunteer application not found", 404);
  if (context.ngo_id !== ngo.ngo_id || context.ngo_user_id !== userId) {
    throw createError("You do not own this need", 403);
  }

  const expectedStatus = expectedStatusFor(targetStatus);
  if (!expectedStatus || context.status !== expectedStatus) {
    throw createError(`Application cannot transition from ${context.status} to ${targetStatus}`, 409);
  }

  const updated = await applicationRepository.updateApplicationStatus({
    needId,
    applicationId,
    expectedStatus,
    status: targetStatus,
  });
  if (!updated) throw createError("Application status changed; reload and try again", 409);
  return updated;
};

module.exports = {
  applyToNeed,
  getApplicationsForUser,
  getApplicationsForNeed,
  reviewApplication,
};

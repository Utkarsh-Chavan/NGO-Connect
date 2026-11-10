const ngoRepository = require("../repositories/ngo.repository");

const createNgoProfile = async (userId, profile) => {
  try {
    return await ngoRepository.createNgo({ userId, ...profile });
  } catch (error) {
    if (error.code === "23505") {
      const conflict = new Error("An NGO profile already exists for this account");
      conflict.statusCode = 409;
      throw conflict;
    }

    throw error;
  }
};

const getNgoProfile = async (userId) => {
  const ngo = await ngoRepository.findNgoByUserId(userId);

  if (!ngo) {
    const error = new Error("NGO profile not found");
    error.statusCode = 404;
    throw error;
  }

  return ngo;
};

const updateNgoProfile = async (userId, profile) => {
  const ngo = await ngoRepository.updateNgoByUserId({
    userId,
    ...profile,
    websiteUrlProvided: Object.prototype.hasOwnProperty.call(profile, "websiteUrl"),
  });

  if (!ngo) {
    const error = new Error("NGO profile not found");
    error.statusCode = 404;
    throw error;
  }

  return ngo;
};

const listPendingNgoProfiles = async ({ limit, offset }) =>
  ngoRepository.findPendingNgos({ limit, offset });

const verifyNgoProfile = async (ngoId, verificationStatus, adminUserId, message) => {
  if (!["APPROVED", "REJECTED"].includes(verificationStatus)) {
    const error = new Error("Verification status must be APPROVED or REJECTED");
    error.statusCode = 400;
    throw error;
  }

  if (verificationStatus === "REJECTED" && (typeof message !== "string" || !message.trim())) {
    const error = new Error("A meaningful rejection message is required");
    error.statusCode = 400;
    error.publicCode = "DECISION_MESSAGE_REQUIRED";
    throw error;
  }

  const ngo = await ngoRepository.updateNgoVerificationStatus({
    ngoId,
    verificationStatus,
    adminUserId,
    message,
  });
  if (!ngo) {
    const error = new Error("NGO profile not found");
    error.statusCode = 404;
    throw error;
  }

  return ngo;
};

module.exports = {
  createNgoProfile,
  getNgoProfile,
  updateNgoProfile,
  listPendingNgoProfiles,
  verifyNgoProfile,
};

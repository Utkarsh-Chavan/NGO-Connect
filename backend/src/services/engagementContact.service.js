const engagementContactRepository = require("../repositories/engagementContact.repository");

const createError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const revealContact = ({ context, userId, role, acceptedStatuses }) => {
  if (!context) throw createError("Engagement not found", 404);

  const isIndividual = role === "INDIVIDUAL" && context.individual_user_id === userId;
  const isOwningNgo = role === "NGO" && context.ngo_user_id === userId;
  if (!isIndividual && !isOwningNgo) throw createError("Engagement not found", 404);
  if (!acceptedStatuses.includes(context.status)) {
    throw createError("Contact details are available only after the engagement is accepted", 403);
  }

  return isIndividual
    ? { name: context.ngo_name, email: context.ngo_email, phone: context.ngo_phone }
    : { name: context.individual_name, email: context.individual_email, phone: context.individual_phone };
};

const getApplicationContact = async ({ userId, role, applicationId }) => revealContact({
  context: await engagementContactRepository.findApplicationContactContext(applicationId),
  userId,
  role,
  acceptedStatuses: ["ACCEPTED", "COMPLETED"],
});

const getContributionContact = async ({ userId, role, contributionId }) => {
  const context = await engagementContactRepository.findContributionContactContext(contributionId);
  if (context?.contribution_type === "MONEY") throw createError("External money support does not create an in-platform contact relationship", 404);
  return revealContact({
    context,
    userId,
    role,
    acceptedStatuses: ["ACCEPTED", "IN_PROGRESS", "COMPLETED"],
  });
};

module.exports = { getApplicationContact, getContributionContact };

const engagementContactService = require("../services/engagementContact.service");

const getApplicationContact = async (req, res, next) => {
  try {
    const contact = await engagementContactService.getApplicationContact({
      userId: req.user.userId,
      role: req.user.role,
      applicationId: req.params.applicationId,
    });
    res.status(200).json({ success: true, message: "Accepted engagement contact retrieved", data: contact });
  } catch (error) {
    next(error);
  }
};

const getContributionContact = async (req, res, next) => {
  try {
    const contact = await engagementContactService.getContributionContact({
      userId: req.user.userId,
      role: req.user.role,
      contributionId: req.params.contributionId,
    });
    res.status(200).json({ success: true, message: "Accepted engagement contact retrieved", data: contact });
  } catch (error) {
    next(error);
  }
};

module.exports = { getApplicationContact, getContributionContact };

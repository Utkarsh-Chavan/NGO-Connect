const applicationService = require("../services/volunteerApplication.service");

const create = async (req, res, next) => {
  try {
    const application = await applicationService.applyToNeed(
      req.user.userId,
      req.params.needId,
      req.body.message ?? null
    );
    res.status(201).json({ success: true, message: "Volunteer application submitted", data: application });
  } catch (error) {
    next(error);
  }
};

const listForUser = async (req, res, next) => {
  try {
    const applications = await applicationService.getApplicationsForUser(req.user.userId);
    res.status(200).json({ success: true, message: "Your volunteer application statuses were retrieved", data: applications });
  } catch (error) {
    next(error);
  }
};

const listForNeed = async (req, res, next) => {
  try {
    const applications = await applicationService.getApplicationsForNeed(req.user.userId, req.params.needId);
    res.status(200).json({ success: true, message: "Volunteer applications retrieved", data: applications });
  } catch (error) {
    next(error);
  }
};

const review = async (req, res, next) => {
  try {
    const application = await applicationService.reviewApplication(
      req.user.userId,
      req.params.needId,
      req.params.applicationId,
      req.body.status
    );
    res.status(200).json({ success: true, message: "Volunteer application updated", data: application });
  } catch (error) {
    next(error);
  }
};

module.exports = { create, listForUser, listForNeed, review };

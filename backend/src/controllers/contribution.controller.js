const contributionService = require("../services/contribution.service");

const create = async (req, res, next) => {
  try {
    const contribution = await contributionService.createContribution(
      req.user.userId,
      req.params.needId,
      req.body
    );
    res.status(201).json({ success: true, message: "Contribution submitted", data: contribution });
  } catch (error) {
    next(error);
  }
};

const listForNeed = async (req, res, next) => {
  try {
    const contributions = await contributionService.listNeedContributions(req.user.userId, req.params.needId);
    res.status(200).json({ success: true, message: "Contributions retrieved", data: contributions });
  } catch (error) {
    next(error);
  }
};

const listForUser = async (req, res, next) => {
  try {
    const contributions = await contributionService.listMyContributions(req.user.userId);
    res.status(200).json({ success: true, message: "Your contributions were retrieved", data: contributions });
  } catch (error) {
    next(error);
  }
};

const updateStatus = async (req, res, next) => {
  try {
    const contribution = await contributionService.updateContributionStatus(
      req.user.userId,
      req.params.needId,
      req.params.contributionId,
      req.body.status
    );
    res.status(200).json({ success: true, message: "Contribution status updated", data: contribution });
  } catch (error) {
    next(error);
  }
};

module.exports = { create, listForNeed, listForUser, updateStatus };

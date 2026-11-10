const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const preferenceController = require("../controllers/preference.controller");
const {
  addCauseValidator,
  causeIdParamValidator,
  addSkillValidator,
  skillParamValidator,
  updateSkillValidator,
} = require("../validators/preference.validator");

const router = express.Router();
const requireIndividual = [authenticate, authorize("INDIVIDUAL")];

router.get("/me/preferences", ...requireIndividual, preferenceController.getPreferences);
router.post(
  "/me/causes",
  ...requireIndividual,
  addCauseValidator,
  validateRequest,
  preferenceController.addCause
);
router.delete(
  "/me/causes/:causeId",
  ...requireIndividual,
  causeIdParamValidator,
  validateRequest,
  preferenceController.removeCause
);
router.post(
  "/me/skills",
  ...requireIndividual,
  addSkillValidator,
  validateRequest,
  preferenceController.addSkill
);
router.put(
  "/me/skills/:skillId",
  ...requireIndividual,
  skillParamValidator,
  updateSkillValidator,
  validateRequest,
  preferenceController.updateSkill
);
router.delete(
  "/me/skills/:skillId",
  ...requireIndividual,
  skillParamValidator,
  validateRequest,
  preferenceController.removeSkill
);

module.exports = router;

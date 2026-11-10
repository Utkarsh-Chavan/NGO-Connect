const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const needController = require("../controllers/need.controller");
const {
  needIdValidator,
  listNeedsValidator,
  createNeedValidator,
  updateNeedValidator,
} = require("../validators/need.validator");

const router = express.Router();

router.post(
  "/",
  authenticate,
  authorize("NGO"),
  createNeedValidator,
  validateRequest,
  needController.create
);
router.get("/", listNeedsValidator, validateRequest, needController.list);
router.get("/:id", needIdValidator, validateRequest, needController.getById);
router.put(
  "/:id",
  authenticate,
  authorize("NGO"),
  needIdValidator,
  updateNeedValidator,
  validateRequest,
  needController.update
);

module.exports = router;

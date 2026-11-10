const express = require("express");

const authenticate = require("../middleware/auth.middleware");
const authorize = require("../middleware/role.middleware");
const validateRequest = require("../middleware/validation.middleware");
const userController = require("../controllers/user.controller");
const preferenceRoutes = require("./preference.routes");
const { updateIndividualProfileValidator } = require("../validators/user.validator");

const router = express.Router();

router.get("/me", authenticate, userController.getMe);
router.put("/me", authenticate, authorize("INDIVIDUAL"), updateIndividualProfileValidator, validateRequest, userController.updateMe);
router.get("/me/dashboard", authenticate, authorize("INDIVIDUAL"), userController.getDashboard);
router.use(preferenceRoutes);

module.exports = router;

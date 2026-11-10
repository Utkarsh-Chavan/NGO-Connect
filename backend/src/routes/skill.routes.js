const express = require("express");

const validateRequest = require("../middleware/validation.middleware");
const skillController = require("../controllers/skill.controller");
const { skillIdValidator } = require("../validators/skill.validator");

const router = express.Router();

router.get("/", skillController.list);
router.get("/:id", skillIdValidator, validateRequest, skillController.getById);

module.exports = router;

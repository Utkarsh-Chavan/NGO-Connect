const express = require("express");

const validateRequest = require("../middleware/validation.middleware");
const causeController = require("../controllers/cause.controller");
const { causeIdValidator } = require("../validators/cause.validator");

const router = express.Router();

router.get("/", causeController.list);
router.get("/:id", causeIdValidator, validateRequest, causeController.getById);

module.exports = router;

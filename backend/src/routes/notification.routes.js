const express = require("express");
const authenticate = require("../middleware/auth.middleware");
const validateRequest = require("../middleware/validation.middleware");
const controller = require("../controllers/notification.controller");
const { listNotificationsValidator, notificationIdValidator } = require("../validators/notification.validator");

const router = express.Router();
router.use(authenticate);
router.get("/", listNotificationsValidator, validateRequest, controller.list);
router.get("/unread-count", controller.unreadCount);
router.patch("/read-all", controller.markAllRead);
router.patch("/:notificationId/read", notificationIdValidator, validateRequest, controller.markRead);

module.exports = router;

const { param, query } = require("express-validator");

const listNotificationsValidator = [
  query("limit").optional().isInt({ min: 1, max: 100 }).withMessage("Limit must be between 1 and 100"),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).withMessage("Offset must be a nonnegative integer"),
  query("unreadOnly").optional().isIn(["true", "false"]).withMessage("unreadOnly must be true or false"),
];

const notificationIdValidator = [
  param("notificationId").isUUID().withMessage("Notification ID must be a valid UUID"),
];

module.exports = { listNotificationsValidator, notificationIdValidator };

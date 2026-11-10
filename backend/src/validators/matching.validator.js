const { query } = require("express-validator");

const recommendationsValidator = [
  query("limit").optional().isInt({ min: 1, max: 100 }).toInt()
    .withMessage("Limit must be an integer between 1 and 100"),
  query("offset").optional().isInt({ min: 0, max: 2147483647 }).toInt()
    .withMessage("Offset must be a nonnegative integer"),
];

module.exports = { recommendationsValidator };

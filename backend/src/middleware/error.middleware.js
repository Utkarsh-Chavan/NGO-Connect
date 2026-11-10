const errorHandler = (err, req, res, next) => {
  const requestedStatus = err.statusCode || err.status;
  const statusCode = Number.isInteger(requestedStatus) && requestedStatus >= 400 && requestedStatus < 600
    ? requestedStatus
    : 500;

  if (statusCode >= 500) {
    console.error("Unhandled API error", {
      method: req.method,
      path: req.originalUrl || req.url,
      name: err.name,
      code: err.code,
    });
  }

  const response = {
    success: false,
    message: statusCode >= 500
      ? "Internal server error"
      : (err.type === "entity.parse.failed" ? "Invalid JSON request body" : (err.message || "Request failed")),
  };

  if (typeof err.publicCode === "string") response.code = err.publicCode;

  res.status(statusCode).json(response);
};

module.exports = errorHandler;

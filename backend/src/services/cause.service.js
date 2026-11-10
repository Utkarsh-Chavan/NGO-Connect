const causeRepository = require("../repositories/cause.repository");

const listAvailableCauses = async () => causeRepository.findAvailableCauses();

const getAvailableCause = async (causeId) => {
  const cause = await causeRepository.findAvailableCauseById(causeId);

  if (!cause) {
    const error = new Error("Cause not found");
    error.statusCode = 404;
    throw error;
  }

  return cause;
};

module.exports = {
  listAvailableCauses,
  getAvailableCause,
};

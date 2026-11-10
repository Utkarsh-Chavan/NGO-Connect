const repository = require("../repositories/adminWorkspace.repository");
const needLifecycleRepository = require("../repositories/needLifecycle.repository");

const fail = (message, statusCode, publicCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  if (publicCode) error.publicCode = publicCode;
  return error;
};

const requireRecord = (record, label) => {
  if (!record) throw fail(`${label} not found`, 404);
  return record;
};

module.exports = {
  getDashboard: () => repository.getDashboard(),
  listUsers: (filters) => repository.listUsers(filters),
  getUser: async (id) => requireRecord(await repository.getUser(id), "User"),
  setUserSuspension: async (input) => requireRecord(await repository.setUserSuspension(input), "User"),
  listNeeds: (filters) => repository.listNeeds(filters),
  getNeed: async (id) => requireRecord(await repository.getNeed(id), "Need"),
  setNeedModeration: async (input) => {
    await needLifecycleRepository.expireDueNeeds();
    return requireRecord(await repository.setNeedModeration(input), "Need");
  },
  getAnalytics: () => repository.getAnalytics(),
};

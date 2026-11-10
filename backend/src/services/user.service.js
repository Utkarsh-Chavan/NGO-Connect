const userRepository = require("../repositories/user.repository");

const getUserProfile = async (userId) => {
  const user = await userRepository.findUserById(userId);

  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }

  return user;
};

const updateUserProfile = async (userId, input) => {
  const user = await userRepository.updateUserProfile(userId, input);
  if (!user) {
    const error = new Error("User not found");
    error.statusCode = 404;
    throw error;
  }
  return user;
};

module.exports = {
  getUserProfile,
  updateUserProfile,
};

const bcrypt = require("bcrypt");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const userRepository = require("../repositories/user.repository");
const transactionRepository = require("../repositories/transaction.repository");
const emailVerificationService = require("./emailVerification.service");

const registerUser = async ({
  name,
  email,
  password,
  role,
  phone,
  city,
  availability,
}) => {
  const existingUser = await userRepository.findUserByEmail(email);

  if (existingUser) {
    const error = new Error("Email is already registered");
    error.statusCode = 409;
    throw error;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const userId = crypto.randomUUID();

  let registration;
  try {
    registration = await transactionRepository.withTransaction(async (client) => {
      const user = await userRepository.createUser({
        userId,
        name,
        email,
        passwordHash,
        role,
        phone,
        city,
        availability,
      }, client);
      const token = await emailVerificationService.createToken(client, userId);
      return { user, token };
    });
  } catch (error) {
    if (error.code === "23505") {
      const conflict = new Error("Email is already registered");
      conflict.statusCode = 409;
      throw conflict;
    }

    throw error;
  }

  const delivery = await emailVerificationService.deliverRegistrationToken({
    user: registration.user,
    ...registration.token,
  });

  return { user: registration.user, emailSent: delivery.delivered, deliveryMode: delivery.mode };
};


const loginUser = async ({ email, password }) => {
  const user = await userRepository.findUserByEmail(email);

  if (!user) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  const passwordMatches = await bcrypt.compare(
    password,
    user.password_hash
  );

  if (!passwordMatches) {
    const error = new Error("Invalid email or password");
    error.statusCode = 401;
    throw error;
  }

  if (user.is_suspended) {
    const error = new Error("This account is suspended. Contact support for assistance.");
    error.statusCode = 403;
    error.publicCode = "ACCOUNT_SUSPENDED";
    throw error;
  }

  if (!user.email_verified) {
    const error = new Error("Verify your email before signing in");
    error.statusCode = 403;
    error.publicCode = "EMAIL_NOT_VERIFIED";
    throw error;
  }

  const token = jwt.sign(
    {
      userId: user.user_id,
      role: user.role,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: process.env.JWT_EXPIRES_IN || "1d",
    }
  );

  return {
    token,
    user: {
      userId: user.user_id,
      name: user.name,
      email: user.email,
      role: user.role,
      phone: user.phone,
      city: user.city,
      availability: user.availability,
    },
  };
};

module.exports = {
  registerUser,
  loginUser,
  resendVerification: (email) => emailVerificationService.resendVerification(email),
  verifyEmail: (token) => emailVerificationService.verifyEmail(token),
};

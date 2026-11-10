const { test } = require("node:test");
const assert = require("node:assert/strict");

process.env.JWT_SECRET = "ngo-connect-service-test-secret";

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const authService = require("../src/services/auth.service");
const userRepository = require("../src/repositories/user.repository");
const transactionRepository = require("../src/repositories/transaction.repository");
const preferenceRepository = require("../src/repositories/preference.repository");
const preferenceService = require("../src/services/preference.service");
const ngoRepository = require("../src/repositories/ngo.repository");
const ngoService = require("../src/services/ngo.service");
const causeRepository = require("../src/repositories/cause.repository");
const causeService = require("../src/services/cause.service");
const skillRepository = require("../src/repositories/skill.repository");
const skillService = require("../src/services/skill.service");
const userService = require("../src/services/user.service");

test("registration maps a concurrent unique-email insert race to 409", async () => {
  const originalFind = userRepository.findUserByEmail;
  const originalCreate = userRepository.createUser;
  const originalHash = bcrypt.hash;
  const originalTransaction = transactionRepository.withTransaction;
  userRepository.findUserByEmail = async () => null;
  userRepository.createUser = async () => {
    const error = new Error("unique constraint");
    error.code = "23505";
    throw error;
  };
  transactionRepository.withTransaction = async (callback) => callback({});
  bcrypt.hash = async () => "test-hash";
  try {
    await assert.rejects(
      authService.registerUser({ name: "Tester", email: "tester@example.test", password: "long-password", role: "INDIVIDUAL" }),
      (error) => error.statusCode === 409 && error.message === "Email is already registered"
    );
  } finally {
    userRepository.findUserByEmail = originalFind;
    userRepository.createUser = originalCreate;
    transactionRepository.withTransaction = originalTransaction;
    bcrypt.hash = originalHash;
  }
});

test("login response contains a signed token and only public user fields", async () => {
  const originalFind = userRepository.findUserByEmail;
  const originalCompare = bcrypt.compare;
  userRepository.findUserByEmail = async () => ({
    user_id: "10000000-0000-4000-8000-000000000001",
    name: "Tester",
    email: "tester@example.test",
    password_hash: "never-return-this",
    role: "INDIVIDUAL",
    email_verified: true,
    phone: null,
    city: "Test City",
    availability: null,
  });
  bcrypt.compare = async () => true;
  try {
    const result = await authService.loginUser({ email: "tester@example.test", password: "password" });
    assert.deepEqual(jwt.verify(result.token, process.env.JWT_SECRET), {
      userId: "10000000-0000-4000-8000-000000000001",
      role: "INDIVIDUAL",
      iat: jwt.decode(result.token).iat,
      exp: jwt.decode(result.token).exp,
    });
    assert.equal(Object.hasOwn(result.user, "password_hash"), false);
  } finally {
    userRepository.findUserByEmail = originalFind;
    bcrypt.compare = originalCompare;
  }
});

test("preference duplicate insert conflicts map to 409", async () => {
  const original = preferenceRepository.addUserCause;
  preferenceRepository.addUserCause = async () => {
    const error = new Error("duplicate key");
    error.code = "23505";
    throw error;
  };
  try {
    await assert.rejects(
      preferenceService.addCause("10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"),
      (error) => error.statusCode === 409
    );
  } finally {
    preferenceRepository.addUserCause = original;
  }
});

test("preference additions reject missing or inactive catalog entries", async () => {
  const originalCause = preferenceRepository.addUserCause;
  const originalSkill = preferenceRepository.addUserSkill;
  preferenceRepository.addUserCause = async () => null;
  preferenceRepository.addUserSkill = async () => null;
  try {
    await assert.rejects(
      preferenceService.addCause("10000000-0000-4000-8000-000000000001", "20000000-0000-4000-8000-000000000001"),
      (error) => error.statusCode === 404
    );
    await assert.rejects(
      preferenceService.addSkill("10000000-0000-4000-8000-000000000001", "30000000-0000-4000-8000-000000000001"),
      (error) => error.statusCode === 404
    );
  } finally {
    preferenceRepository.addUserCause = originalCause;
    preferenceRepository.addUserSkill = originalSkill;
  }
});

test("cause and skill services return 404 for unavailable catalog entries", async () => {
  const originalCause = causeRepository.findAvailableCauseById;
  const originalSkill = skillRepository.findAvailableSkillById;
  causeRepository.findAvailableCauseById = async () => null;
  skillRepository.findAvailableSkillById = async () => null;
  try {
    await assert.rejects(causeService.getAvailableCause("20000000-0000-4000-8000-000000000001"), (error) => error.statusCode === 404);
    await assert.rejects(skillService.getAvailableSkill("30000000-0000-4000-8000-000000000001"), (error) => error.statusCode === 404);
  } finally {
    causeRepository.findAvailableCauseById = originalCause;
    skillRepository.findAvailableSkillById = originalSkill;
  }
});

test("NGO duplicate profile conflicts map to 409 and missing user profile maps to 404", async () => {
  const originalCreate = ngoRepository.createNgo;
  const originalFindUser = require("../src/repositories/user.repository").findUserById;
  ngoRepository.createNgo = async () => {
    const error = new Error("duplicate key");
    error.code = "23505";
    throw error;
  };
  require("../src/repositories/user.repository").findUserById = async () => null;
  try {
    await assert.rejects(
      ngoService.createNgoProfile("10000000-0000-4000-8000-000000000001", {}),
      (error) => error.statusCode === 409
    );
    await assert.rejects(
      userService.getUserProfile("10000000-0000-4000-8000-000000000001"),
      (error) => error.statusCode === 404
    );
  } finally {
    ngoRepository.createNgo = originalCreate;
    require("../src/repositories/user.repository").findUserById = originalFindUser;
  }
});

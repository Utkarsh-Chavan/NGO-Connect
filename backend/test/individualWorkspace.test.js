const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");
const userRepository = require("../src/repositories/user.repository");
const dashboardRepository = require("../src/repositories/individualDashboard.repository");
const userService = require("../src/services/user.service");
const { updateIndividualProfileValidator } = require("../src/validators/user.validator");

const userId = "10000000-0000-4000-8000-000000000001";

test("individual profile update is scoped and returns only public fields", async () => {
  const original = userRepository.updateUserProfile;
  let received;
  userRepository.updateUserProfile = async (...args) => {
    received = args;
    return { user_id: userId, name: "Asha", email: "asha@example.test", role: "INDIVIDUAL", phone: null, city: null };
  };
  try {
    const result = await userService.updateUserProfile(userId, { name: "Asha", phone: null, city: null, availability: null });
    assert.equal(received[0], userId);
    assert.equal(result.role, "INDIVIDUAL");
    assert.equal(Object.hasOwn(result, "password_hash"), false);
  } finally { userRepository.updateUserProfile = original; }
});

test("individual profile service reports a deleted account as 404", async () => {
  const original = userRepository.updateUserProfile;
  userRepository.updateUserProfile = async () => null;
  try { await assert.rejects(userService.updateUserProfile(userId, { name: "Asha" }), (error) => error.statusCode === 404); }
  finally { userRepository.updateUserProfile = original; }
});

test("profile validator allows permitted profile fields and rejects role or ownership fields", async () => {
  const validRequest = { body: { name: "Asha", phone: null, city: "Pune", availability: { weekdays: true } }, params: {}, query: {} };
  await Promise.all(updateIndividualProfileValidator.map((validator) => validator.run(validRequest)));
  assert.equal(validationResult(validRequest).isEmpty(), true);

  const invalidRequest = { body: { name: "Asha", role: "ADMIN", userId }, params: {}, query: {} };
  await Promise.all(updateIndividualProfileValidator.map((validator) => validator.run(invalidRequest)));
  assert.ok(validationResult(invalidRequest).array().some((error) => error.msg.includes("Unsupported field")));
});

test("dashboard repository combines applications and contributions in one user-scoped query", async () => {
  const pool = require("../src/config/database");
  const original = pool.query;
  let captured;
  pool.query = async (sql, values) => { captured = { sql, values }; return { rows: [{ pending: 0, accepted: 0, in_progress: 0, completed: 0, recent_activity: [] }] }; };
  try {
    const result = await dashboardRepository.findIndividualDashboard(userId);
    assert.deepEqual(captured.values, [userId]);
    assert.equal((captured.sql.match(/WHERE .*\.user_id = \$1/g) || []).length, 2);
    assert.match(captured.sql, /UNION ALL/);
    assert.match(captured.sql, /LIMIT 8/);
    assert.deepEqual(result.recent_activity, []);
  } finally { pool.query = original; }
});

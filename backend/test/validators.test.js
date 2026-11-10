const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");

const {
  registerValidator,
  loginValidator,
  verificationTokenValidator,
  resendVerificationValidator,
} = require("../src/validators/auth.validator");
const { createNgoValidator, updateNgoValidator, normalizeWebsiteUrl } = require("../src/validators/ngo.validator");
const {
  addCauseValidator,
  causeIdParamValidator,
  addSkillValidator,
  skillParamValidator,
  updateSkillValidator,
} = require("../src/validators/preference.validator");
const { causeIdValidator } = require("../src/validators/cause.validator");
const { skillIdValidator } = require("../src/validators/skill.validator");
const validateRequest = require("../src/middleware/validation.middleware");

const check = async (validators, body, params = {}) => {
  const req = { body, params, query: {} };
  for (const validator of validators) {
    await new Promise((resolve, reject) => {
      validator(req, {}, (error) => error ? reject(error) : resolve());
    });
  }

  let response;
  const res = {
    status(code) { this.statusCode = code; return this; },
    json(payload) { response = { statusCode: this.statusCode, payload }; },
  };
  let passed = false;
  validateRequest(req, res, () => { passed = true; });
  return { passed, response, errors: validationResult(req).array() };
};

test("registration validator accepts nullable JSONB availability and supported roles", async () => {
  const result = await check(registerValidator, {
    name: "Test User",
    email: "user@example.test",
    password: "secure-password",
    role: "INDIVIDUAL",
    availability: null,
  });
  assert.equal(result.passed, true);
});

test("NGO website URL is normalized and restricted to credential-free HTTP(S)", () => {
  assert.equal(normalizeWebsiteUrl("  HTTPS://Example.org/path  "), "https://example.org/path");
  assert.equal(normalizeWebsiteUrl(""), null);
  for (const value of ["javascript:alert(1)", "file:///tmp/a", "//example.org", "https://user:pass@example.org"]) {
    assert.throws(() => normalizeWebsiteUrl(value));
  }
  assert.throws(() => normalizeWebsiteUrl(`https://example.org/${"a".repeat(260)}`), /255 characters/);
});

test("registration validator rejects admin self-registration and non-string profile fields", async () => {
  const base = { name: "Test User", email: "user@example.test", password: "secure-password" };
  for (const body of [
    { ...base, role: "ADMIN" },
    { ...base, name: 42 },
    { ...base, email: { value: "user@example.test" } },
    { ...base, phone: 12345 },
    { ...base, city: { value: "Test City" } },
  ]) {
    assert.equal((await check(registerValidator, body)).passed, false);
  }
});

test("login validator requires string email and password", async () => {
  assert.equal((await check(loginValidator, {
    email: "user@example.test", password: "password",
  })).passed, true);
  assert.equal((await check(loginValidator, {
    email: "user@example.test", password: 12345,
  })).passed, false);
});

test("email verification validators accept canonical tokens and valid resend emails", async () => {
  assert.equal((await check(verificationTokenValidator, { token: "A".repeat(43) })).passed, true);
  assert.equal((await check(verificationTokenValidator, { token: "not-a-token" })).passed, false);
  assert.equal((await check(resendVerificationValidator, { email: "USER@example.test" })).passed, true);
  assert.equal((await check(resendVerificationValidator, { email: "invalid" })).passed, false);
});

test("NGO profile validators accept valid profile fields and reject protected or oversized fields", async () => {
  const validBody = { name: "Community Aid", email: "aid@example.test", city: "Test City" };
  assert.equal((await check(createNgoValidator, validBody)).passed, true);
  assert.equal((await check(updateNgoValidator, validBody)).passed, true);

  for (const body of [
    { ...validBody, user_id: "10000000-0000-4000-8000-000000000001" },
    { ...validBody, verification_status: "APPROVED" },
    { ...validBody, phone: "1".repeat(21) },
    { name: "", email: "aid@example.test", city: "Test City" },
  ]) {
    assert.equal((await check(createNgoValidator, body)).passed, false);
  }
});

test("preference validators enforce UUIDs, proficiency values, and strict body allowlists", async () => {
  const validCause = { causeId: "20000000-0000-4000-8000-000000000001" };
  const validSkill = { skillId: "30000000-0000-4000-8000-000000000001", proficiencyLevel: "ADVANCED" };
  assert.equal((await check(addCauseValidator, validCause)).passed, true);
  assert.equal((await check(addSkillValidator, validSkill)).passed, true);
  assert.equal((await check(updateSkillValidator, { proficiencyLevel: "EXPERT" })).passed, true);

  assert.equal((await check(addCauseValidator, { ...validCause, userId: "forged" })).passed, false);
  assert.equal((await check(addCauseValidator, { causeId: "not-a-uuid" })).passed, false);
  assert.equal((await check(addSkillValidator, { ...validSkill, proficiencyLevel: "MASTER" })).passed, false);
  assert.equal((await check(updateSkillValidator, { proficiencyLevel: "BEGINNER", skillId: validSkill.skillId })).passed, false);
});

test("catalog and preference path validators accept UUIDs and reject malformed IDs", async () => {
  const valid = "30000000-0000-4000-8000-000000000001";
  for (const [validators, req] of [
    [causeIdValidator, { id: valid }],
    [skillIdValidator, { id: valid }],
    [causeIdParamValidator, { causeId: valid }],
    [skillParamValidator, { skillId: valid }],
  ]) {
    assert.equal((await check(validators, {}, req)).passed, true);
  }
  assert.equal((await check(skillParamValidator, {}, { skillId: "bad" })).passed, false);
});

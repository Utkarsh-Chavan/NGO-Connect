const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

process.env.JWT_SECRET = "ngo-connect-matching-test-secret";

const pool = require("../src/config/database");
const matchingRepository = require("../src/repositories/matching.repository");
const realFindEligibleNeeds = matchingRepository.findEligibleNeedsForUser;
const matchingService = require("../src/services/matching.service");
const matchingController = require("../src/controllers/matching.controller");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");
const authorize = require("../src/middleware/role.middleware");
const validateRequest = require("../src/middleware/validation.middleware");
const { recommendationsValidator } = require("../src/validators/matching.validator");

const individualId = "10000000-0000-4000-8000-000000000001";
const needId1 = "20000000-0000-4000-8000-000000000001";
const needId2 = "20000000-0000-4000-8000-000000000002";
const now = new Date("2026-10-01T12:00:00.000Z");

const baseNeed = (overrides = {}) => ({
  need_id: needId1,
  cause_id: "30000000-0000-4000-8000-000000000001",
  title: "School supplies",
  description: "Materials for a school program",
  contribution_type: "MATERIAL",
  location: "Pune",
  availability: null,
  quantity_required: 10,
  quantity_fulfilled: 0,
  priority: "MEDIUM",
  deadline: "2099-10-15T00:00:00.000Z",
  status: "ACTIVE",
  created_at: "2026-09-30T10:00:00.000Z",
  updated_at: "2026-09-30T10:00:00.000Z",
  ngo_name: "Community NGO",
  cause_name: "Education",
  userCity: "Pune",
  ngoCity: "Pune",
  causePreferenceMatch: true,
  requiredSkills: [],
  ...overrides,
});

const makeResponse = () => ({
  statusCode: 200,
  body: undefined,
  status(code) { this.statusCode = code; return this; },
  json(body) { this.body = body; return this; },
});

const runValidators = async (validators, req) => {
  for (const validator of validators) {
    await new Promise((resolve, reject) => {
      validator(req, {}, (error) => error ? reject(error) : resolve());
    });
  }
  const res = makeResponse();
  let continued = false;
  validateRequest(req, res, () => { continued = true; });
  return { valid: continued, response: res, errors: validationResult(req).array() };
};

beforeEach(() => {
  matchingRepository.findEligibleNeedsForUser = async () => [];
});

test("eligibility includes public active/partial needs and excludes hidden or expired needs", () => {
  assert.equal(matchingService.isEligibleNeed(baseNeed(), now), true);
  assert.equal(matchingService.isEligibleNeed(baseNeed({ status: "PARTIALLY_FULFILLED" }), now), true);
  for (const status of ["DRAFT", "FULFILLED", "EXPIRED"]) {
    assert.equal(matchingService.isEligibleNeed(baseNeed({ status }), now), false);
  }
  assert.equal(matchingService.isEligibleNeed(baseNeed({ deadline: now.toISOString() }), now), false);
  assert.equal(matchingService.isEligibleNeed(baseNeed({ deadline: "not-a-date" }), now), false);
  assert.equal(matchingService.isEligibleNeed(baseNeed({ deadline: null }), now), true);
});

test("scoring is explainable and reaches the documented 100-point maximum", () => {
  const scored = matchingService.scoreNeed(baseNeed({
    priority: "URGENT",
    requiredSkills: [
      { skillId: "skill-1", name: "Teaching", requiredLevel: "INTERMEDIATE", proficiencyLevel: "ADVANCED" },
      { skillId: "skill-2", name: "Design", requiredLevel: "BEGINNER", proficiencyLevel: "EXPERT" },
      { skillId: "skill-3", name: "Writing", requiredLevel: "ADVANCED", proficiencyLevel: "ADVANCED" },
      { skillId: "skill-4", name: "Photography", requiredLevel: "EXPERT", proficiencyLevel: "BEGINNER" },
    ],
  }), now);

  assert.equal(scored.score, 100);
  assert.equal(scored.reasons.filter((reason) => reason.startsWith("Skill match:")).length, 3);
  assert.ok(scored.reasons.includes("Matches your cause preference: Education"));
  assert.ok(scored.reasons.includes("Located in your city: Pune"));
  assert.ok(scored.reasons.includes("Priority: URGENT (+10)"));
  assert.equal(Object.hasOwn(scored, "userCity"), false);
  assert.equal(Object.hasOwn(scored, "requiredSkills"), false);
});

test("skill points require proficiency at or above the requested level and are deduplicated", () => {
  const scored = matchingService.scoreNeed(baseNeed({
    causePreferenceMatch: false,
    userCity: null,
    ngoCity: null,
    location: null,
    priority: "LOW",
    requiredSkills: [
      { skillId: "skill-1", name: "Teaching", requiredLevel: "ADVANCED", proficiencyLevel: "INTERMEDIATE" },
      { skillId: "skill-2", name: "Writing", requiredLevel: "BEGINNER", proficiencyLevel: "EXPERT" },
      { skillId: "skill-2", name: "Writing", requiredLevel: "BEGINNER", proficiencyLevel: "EXPERT" },
    ],
  }), now);
  assert.equal(scored.score, 11);
  assert.equal(scored.reasons.filter((reason) => reason.startsWith("Skill match:")).length, 1);
});

test("empty preferences remain eligible and use only available location and priority factors", () => {
  const scored = matchingService.scoreNeed(baseNeed({
    causePreferenceMatch: false,
    requiredSkills: [],
    userCity: null,
    ngoCity: "Pune",
    priority: "LOW",
  }), now);
  assert.equal(scored.score, 1);
  assert.deepEqual(scored.reasons, ["Priority: LOW (+1)"]);
});

test("location scoring uses exact normalized city equality, not substring matches", () => {
  const exact = matchingService.scoreNeed(baseNeed({
    causePreferenceMatch: false, requiredSkills: [], priority: "LOW", userCity: " PUNE ", ngoCity: "Pune",
  }), now);
  const partial = matchingService.scoreNeed(baseNeed({
    causePreferenceMatch: false, requiredSkills: [], priority: "LOW", userCity: "Pune", ngoCity: "Pune District", location: null,
  }), now);
  assert.equal(exact.score, 21);
  assert.equal(partial.score, 1);
});

test("rank is deterministic, filters eligibility before priority, and breaks ties consistently", () => {
  const newer = baseNeed({ need_id: needId2, causePreferenceMatch: false, requiredSkills: [], userCity: null, ngoCity: null, location: null, priority: "URGENT", created_at: "2026-09-30T11:00:00.000Z" });
  const older = baseNeed({ need_id: needId1, causePreferenceMatch: false, requiredSkills: [], userCity: null, ngoCity: null, location: null, priority: "URGENT", created_at: "2026-09-30T10:00:00.000Z" });
  const ineligibleUrgent = baseNeed({ need_id: "20000000-0000-4000-8000-000000000003", status: "DRAFT", priority: "URGENT" });
  const ranked = matchingService.rankRecommendations([older, ineligibleUrgent, newer], { limit: 10, offset: 0, now });
  assert.deepEqual(ranked.map((need) => need.need_id), [needId2, needId1]);
  assert.deepEqual(matchingService.rankRecommendations([older, newer], { limit: 1, offset: 1, now }).map((need) => need.need_id), [needId1]);
});

test("flat query rows aggregate repeated skills into one need without duplicating results", () => {
  const row = {
    need_id: needId1, cause_id: "cause-1", title: "A need", description: "Details",
    contribution_type: "SKILL", location: null, availability: null,
    quantity_required: null, quantity_fulfilled: 0, priority: "HIGH",
    deadline: null, status: "ACTIVE", created_at: now, updated_at: now,
    ngo_name: "NGO", ngo_city: null, cause_name: "Education", user_city: null,
    cause_preference_match: false, required_skill_id: "skill-1", required_skill_name: "Teaching",
    required_level: "BEGINNER", user_proficiency_level: "EXPERT",
  };
  const aggregated = matchingService.aggregateNeedRows([row, row]);
  assert.equal(aggregated.length, 1);
  assert.equal(aggregated[0].requiredSkills.length, 2);
  const ranked = matchingService.rankRecommendations(aggregated, { now });
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].score, 17);
});

test("recommendation service ranks all candidates before applying pagination", async () => {
  matchingRepository.findEligibleNeedsForUser = async (userId) => {
    assert.equal(userId, individualId);
    return [
      { ...baseNeed({ need_id: needId1, priority: "LOW", causePreferenceMatch: false, requiredSkills: [], userCity: null, ngoCity: null, location: null }) },
      { ...baseNeed({ need_id: needId2, priority: "URGENT", causePreferenceMatch: false, requiredSkills: [], userCity: null, ngoCity: null, location: null }) },
    ];
  };
  const result = await matchingService.getRecommendations(individualId, { limit: 1, offset: 0 });
  assert.equal(result.total, 2);
  assert.equal(result.items[0].need_id, needId2);
});

test("repository query binds only authenticated user id and filters public eligible needs", async () => {
  const originalQuery = pool.query;
  let sql;
  let values;
  pool.query = async (query, parameters) => {
    sql = query;
    values = parameters;
    return { rows: [] };
  };
  try {
    await realFindEligibleNeeds(individualId);
  } finally {
    pool.query = originalQuery;
  }
  assert.match(sql, /n\.status IN \('ACTIVE', 'PARTIALLY_FULFILLED'\)/);
  assert.match(sql, /g\.verification_status = 'APPROVED'/);
  assert.match(sql, /n\.deadline IS NULL OR n\.deadline > clock_timestamp\(\)/);
  assert.match(sql, /user_causes/);
  assert.match(sql, /need_skills/);
  assert.match(sql, /user_skills/);
  assert.match(sql, /viewer\.city AS user_city/);
  assert.match(sql, /g\.city AS ngo_city/);
  assert.deepEqual(values, [individualId]);
});

test("pagination validator constrains page size and offset", async () => {
  assert.equal((await runValidators(recommendationsValidator, { query: { limit: "50", offset: "10" }, params: {}, body: {} })).valid, true);
  assert.equal((await runValidators(recommendationsValidator, { query: { limit: "101" }, params: {}, body: {} })).valid, false);
  assert.equal((await runValidators(recommendationsValidator, { query: { offset: "-1" }, params: {}, body: {} })).valid, false);
});

test("recommendation route auth checks missing, invalid, and wrong-role credentials", async () => {
  const missing = makeResponse();
  authenticate({ headers: {} }, missing, () => assert.fail("must not continue"));
  assert.equal(missing.statusCode, 401);
  const invalid = makeResponse();
  authenticate({ headers: { authorization: "Bearer invalid" } }, invalid, () => {});
  assert.equal(invalid.statusCode, 401);
  const denied = makeResponse();
  authorize("INDIVIDUAL")({ user: { role: "NGO" } }, denied, () => assert.fail("must not continue"));
  assert.equal(denied.statusCode, 403);
  const token = jwt.sign({ userId: individualId, role: "INDIVIDUAL" }, process.env.JWT_SECRET);
  const originalStatus = userRepository.findAuthStatusById;
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: false });
  let continued = false;
  await authenticate({ headers: { authorization: `Bearer ${token}` } }, makeResponse(), () => { continued = true; });
  userRepository.findAuthStatusById = originalStatus;
  assert.equal(continued, true);
});

test("controller returns shared pagination envelope and forwards errors", async () => {
  const originalGet = matchingService.getRecommendations;
  let forwarded;
  const response = makeResponse();
  try {
    matchingService.getRecommendations = async () => ({ items: [{ need_id: needId1, score: 40, reasons: [] }], total: 1 });
    await matchingController.getRecommendations({ user: { userId: individualId }, query: { limit: 20, offset: 0 } }, response, (error) => { forwarded = error; });
    assert.equal(response.statusCode, 200);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.pagination.total, 1);

    const expectedError = new Error("repository failure");
    matchingService.getRecommendations = async () => { throw expectedError; };
    await matchingController.getRecommendations({ user: { userId: individualId }, query: {} }, makeResponse(), (error) => { forwarded = error; });
    assert.equal(forwarded, expectedError);
  } finally {
    matchingService.getRecommendations = originalGet;
  }
});

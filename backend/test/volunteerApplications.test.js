const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

process.env.JWT_SECRET = "ngo-connect-volunteer-test-secret";

const applicationRepository = require("../src/repositories/volunteerApplication.repository");
const realCreateApplication = applicationRepository.createApplication;
const realFindApplicationsForUser = applicationRepository.findApplicationsForUser;
const ngoRepository = require("../src/repositories/ngo.repository");
const needRepository = require("../src/repositories/need.repository");
const applicationService = require("../src/services/volunteerApplication.service");
const applicationController = require("../src/controllers/volunteerApplication.controller");
const applicationRoutes = require("../src/routes/volunteerApplication.routes");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");
const authorize = require("../src/middleware/role.middleware");
const validateRequest = require("../src/middleware/validation.middleware");
const {
  needIdValidator,
  applicationPathValidator,
  createApplicationValidator,
  reviewApplicationValidator,
} = require("../src/validators/volunteerApplication.validator");

const individualId = "10000000-0000-4000-8000-000000000001";
const ngoUserId = "10000000-0000-4000-8000-000000000002";
const otherNgoUserId = "10000000-0000-4000-8000-000000000003";
const needId = "20000000-0000-4000-8000-000000000001";
const applicationId = "30000000-0000-4000-8000-000000000001";
const ngoId = "40000000-0000-4000-8000-000000000001";

let repositoryCalls;
let currentApplicationStatus;
let needContributionType;

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
  repositoryCalls = { create: 0, mine: 0, list: 0, context: 0, update: 0 };
  currentApplicationStatus = "APPLIED";
  needContributionType = "VOLUNTEER";
  ngoRepository.findNgoByUserId = async (userId) => {
    if (userId === ngoUserId) return { ngo_id: ngoId };
    if (userId === otherNgoUserId) return { ngo_id: "40000000-0000-4000-8000-000000000002" };
    return null;
  };
  needRepository.findNeedOwnerById = async (id) => id === needId ? { need_id: id, ngo_id: ngoId } : null;
  applicationRepository.createApplication = async (input) => {
    repositoryCalls.create += 1;
    return { application_id: applicationId, status: "APPLIED", ...input };
  };
  applicationRepository.findNeedContributionType = async () => needContributionType;
  applicationRepository.findApplicationsForNeed = async (id) => {
    repositoryCalls.list += 1;
    return [{ need_id: id, applicant_id: individualId, applicant_name: "Volunteer" }];
  };
  applicationRepository.findApplicationsForUser = async (userId) => {
    repositoryCalls.mine += 1;
    return userId === individualId ? [{ need_id: needId, status: currentApplicationStatus }] : [];
  };
  applicationRepository.findApplicationReviewContext = async ({ needId: id, applicationId: appId }) => {
    repositoryCalls.context += 1;
    if (id !== needId || appId !== applicationId) return null;
    return { application_id: appId, need_id: id, status: currentApplicationStatus, ngo_id: ngoId, ngo_user_id: ngoUserId };
  };
  applicationRepository.updateApplicationStatus = async (input) => {
    repositoryCalls.update += 1;
    if (input.expectedStatus !== currentApplicationStatus) return null;
    currentApplicationStatus = input.status;
    return { application_id: input.applicationId, need_id: input.needId, status: input.status };
  };
});

test("individual application derives user identity and relies on database APPLIED default", async () => {
  const result = await applicationService.applyToNeed(individualId, needId, "I can help on weekends");
  assert.equal(result.status, "APPLIED");
  assert.deepEqual(repositoryCalls, { create: 1, mine: 0, list: 0, context: 0, update: 0 });
});

test("applications are rejected for MATERIAL, MONEY, and SKILL needs", async () => {
  for (const contributionType of ["MATERIAL", "MONEY", "SKILL"]) {
    needContributionType = contributionType;
    await assert.rejects(
      applicationService.applyToNeed(individualId, needId),
      (error) => error.statusCode === 400 && /only accepted for VOLUNTEER needs/.test(error.message)
    );
  }
  assert.equal(repositoryCalls.create, 0);
});

test("individual application history lookup remains scoped to the authenticated user", async () => {
  currentApplicationStatus = "ACCEPTED";
  assert.deepEqual(await applicationService.getApplicationsForUser(individualId), [
    { need_id: needId, status: "ACCEPTED" },
  ]);
  assert.deepEqual(await applicationService.getApplicationsForUser(otherNgoUserId), []);
  assert.equal(repositoryCalls.mine, 2);
});

test("own application status SQL is parameterized and returns no other applicant fields", async () => {
  const pool = require("../src/config/database");
  const originalQuery = pool.query;
  let sql;
  let values;
  pool.query = async (query, parameters) => {
    sql = query;
    values = parameters;
    return { rows: [{ application_id: applicationId, need_id: needId, status: "APPLIED", need_title: "Need", ngo_name: "NGO", message: null, applied_at: "2026-01-01" }] };
  };
  try {
    assert.deepEqual(await realFindApplicationsForUser(individualId), [{ application_id: applicationId, need_id: needId, status: "APPLIED", need_title: "Need", ngo_name: "NGO", message: null, applied_at: "2026-01-01" }]);
  } finally {
    pool.query = originalQuery;
  }
  assert.deepEqual(values, [individualId]);
  assert.match(sql, /WHERE va\.user_id = \$1/);
  assert.match(sql, /va\.message, va\.resolution_reason,[\s\S]*va\.applied_at/);
  assert.match(sql, /n\.title AS need_title,[\s\S]*g\.name AS ngo_name/);
  assert.doesNotMatch(sql, /applicant_name|applicant_city|va\.user_id\s*,/i);
});

test("duplicate applications map the schema unique constraint to 409", async () => {
  const duplicateError = () => {
    const error = new Error("duplicate key");
    error.code = "23505";
    error.constraint = "uq_volunteer_application";
    throw error;
  };
  applicationRepository.createApplication = duplicateError;
  await assert.rejects(
    applicationService.applyToNeed(individualId, needId),
    (error) => error.statusCode === 409
  );

  applicationRepository.createApplication = async () => {
    const error = new Error("unexpected unique constraint");
    error.code = "23505";
    error.constraint = "volunteer_applications_pkey";
    throw error;
  };
  await assert.rejects(
    applicationService.applyToNeed(individualId, needId),
    (error) => error.statusCode === undefined
  );
});

test("missing, inactive, or expired application targets return 404", async () => {
  applicationRepository.createApplication = async () => null;
  await assert.rejects(
    applicationService.applyToNeed(individualId, needId),
    (error) => error.statusCode === 404
  );
});

test("application SQL restricts inserts to active non-expired needs and is parameterized", async () => {
  const pool = require("../src/config/database");
  const originalConnect = pool.connect;
  let sql;
  let values;
  const executed = [];
  pool.connect = async () => ({
    query: async (query, parameters) => {
      executed.push(query);
      if (query.includes("FOR UPDATE OF n")) return { rows: [{ need_id: needId }] };
      if (query.includes("INSERT INTO volunteer_applications")) {
        sql = query;
        values = parameters;
        return { rows: [{ application_id: applicationId }] };
      }
      return { rows: [], rowCount: 1 };
    },
    release() {},
  });
  try {
    await realCreateApplication({ needId, userId: individualId, message: null });
  } finally {
    pool.connect = originalConnect;
  };
  assert.ok(sql, executed.map((query) => query.replace(/\s+/g, " ").trim()).join(" | "));
  assert.match(sql, /n\.status = 'ACTIVE'/);
  assert.match(sql, /n\.contribution_type = 'VOLUNTEER'/);
  assert.match(sql, /g\.verification_status = 'APPROVED'/);
  assert.match(sql, /n\.deadline IS NULL OR n\.deadline > clock_timestamp\(\)/);
  assert.match(sql, /JOIN ngos g ON g\.ngo_id = n\.ngo_id/);
  assert.match(sql, /SELECT n\.need_id, \$2, \$3/);
  assert.deepEqual(values, [needId, individualId, null]);
});

test("only the owning NGO may list applications for an existing need", async () => {
  const applications = await applicationService.getApplicationsForNeed(ngoUserId, needId);
  assert.equal(applications.length, 1);
  await assert.rejects(
    applicationService.getApplicationsForNeed(otherNgoUserId, needId),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    applicationService.getApplicationsForNeed(ngoUserId, "20000000-0000-4000-8000-000000000099"),
    (error) => error.statusCode === 404
  );
  assert.equal(repositoryCalls.list, 1);
});

test("review permits only APPLIED to ACCEPTED/REJECTED and ACCEPTED to COMPLETED", async () => {
  const accepted = await applicationService.reviewApplication(ngoUserId, needId, applicationId, "ACCEPTED");
  assert.equal(accepted.status, "ACCEPTED");
  const completed = await applicationService.reviewApplication(ngoUserId, needId, applicationId, "COMPLETED");
  assert.equal(completed.status, "COMPLETED");

  currentApplicationStatus = "APPLIED";
  const rejected = await applicationService.reviewApplication(ngoUserId, needId, applicationId, "REJECTED");
  assert.equal(rejected.status, "REJECTED");
  await assert.rejects(
    applicationService.reviewApplication(ngoUserId, needId, applicationId, "ACCEPTED"),
    (error) => error.statusCode === 409
  );
  await assert.rejects(
    applicationService.reviewApplication(ngoUserId, needId, applicationId, "COMPLETED"),
    (error) => error.statusCode === 409
  );
});

test("review is owner-scoped, returns 404 for missing application, and handles concurrent state changes", async () => {
  await assert.rejects(
    applicationService.reviewApplication(otherNgoUserId, needId, applicationId, "ACCEPTED"),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    applicationService.reviewApplication(ngoUserId, needId, "30000000-0000-4000-8000-000000000099", "ACCEPTED"),
    (error) => error.statusCode === 404
  );
  applicationRepository.updateApplicationStatus = async () => null;
  await assert.rejects(
    applicationService.reviewApplication(ngoUserId, needId, applicationId, "ACCEPTED"),
    (error) => error.statusCode === 409
  );
});

test("validators reject malformed IDs, unsupported fields, and arbitrary statuses", async () => {
  const validParams = { params: { needId, applicationId }, body: {} };
  assert.equal((await runValidators(applicationPathValidator, validParams)).valid, true);
  assert.equal((await runValidators(needIdValidator, { params: { needId: "bad" }, body: {} })).valid, false);
  assert.equal((await runValidators(createApplicationValidator, {
    params: { needId }, body: { message: "hello", userId: individualId },
  })).valid, false);
  assert.equal((await runValidators(createApplicationValidator, {
    params: { needId }, body: { message: 123 },
  })).valid, false);
  for (const status of ["APPLIED", "PENDING", "CANCELLED"]) {
    assert.equal((await runValidators(reviewApplicationValidator, { params: {}, body: { status } })).valid, false);
  }
  for (const status of ["ACCEPTED", "REJECTED", "COMPLETED"]) {
    assert.equal((await runValidators(reviewApplicationValidator, { params: {}, body: { status } })).valid, true);
  }
});

test("authentication and role authorization protect application routes", async () => {
  const missingTokenResponse = makeResponse();
  authenticate({ headers: {} }, missingTokenResponse, () => assert.fail("must not continue"));
  assert.equal(missingTokenResponse.statusCode, 401);

  const invalidTokenResponse = makeResponse();
  authenticate({ headers: { authorization: "Bearer invalid" } }, invalidTokenResponse, () => {});
  assert.equal(invalidTokenResponse.statusCode, 401);

  const forbiddenResponse = makeResponse();
  authorize("INDIVIDUAL")({ user: { role: "NGO" } }, forbiddenResponse, () => assert.fail("must not continue"));
  assert.equal(forbiddenResponse.statusCode, 403);

  const validResponse = makeResponse();
  const token = jwt.sign({ userId: individualId, role: "INDIVIDUAL" }, process.env.JWT_SECRET);
  const originalStatus = userRepository.findAuthStatusById;
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: false });
  let continued = false;
  await authenticate({ headers: { authorization: `Bearer ${token}` } }, validResponse, () => { continued = true; });
  userRepository.findAuthStatusById = originalStatus;
  assert.equal(continued, true);

  const createLayer = applicationRoutes.stack.find((entry) => entry.route?.path === "/needs/:needId/applications");
  assert.ok(createLayer);
  assert.equal(createLayer.route.methods.post, true);
  assert.equal(createLayer.route.stack[0].handle, authenticate);
  const unauthorizedResponse = makeResponse();
  let createContinued = false;
  createLayer.route.stack[1].handle({ user: { role: "NGO" } }, unauthorizedResponse, () => { createContinued = true; });
  assert.equal(unauthorizedResponse.statusCode, 403);
  assert.equal(createContinued, false);
});

test("my application status route is authenticated and individual-only", () => {
  const layer = applicationRoutes.stack.find((entry) => entry.route?.path === "/users/me/applications");
  assert.ok(layer);
  assert.equal(layer.route.methods.get, true);
  assert.equal(layer.route.stack.length, 3);
  assert.equal(layer.route.stack[0].handle, authenticate);

  for (const role of ["NGO", "ADMIN"]) {
    const response = makeResponse();
    let continued = false;
    layer.route.stack[1].handle({ user: { role } }, response, () => { continued = true; });
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }
  const individualResponse = makeResponse();
  let individualContinued = false;
  layer.route.stack[1].handle({ user: { role: "INDIVIDUAL" } }, individualResponse, () => { individualContinued = true; });
  assert.equal(individualContinued, true);
});

test("controller returns the shared response shape and forwards service errors", async () => {
  const originalApply = applicationService.applyToNeed;
  let forwarded;
  const response = makeResponse();
  try {
    applicationService.applyToNeed = async (userId, id, message) => ({ application_id: applicationId, userId, id, message });
    await applicationController.create({ user: { userId: individualId }, params: { needId }, body: { message: "hi" } }, response, (err) => { forwarded = err; });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.userId, individualId);

    const expectedError = new Error("service failure");
    applicationService.applyToNeed = async () => { throw expectedError; };
    await applicationController.create({ user: { userId: individualId }, params: { needId }, body: {} }, makeResponse(), (err) => { forwarded = err; });
    assert.equal(forwarded, expectedError);
  } finally {
    applicationService.applyToNeed = originalApply;
  }
});

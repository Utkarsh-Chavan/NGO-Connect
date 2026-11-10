const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

process.env.JWT_SECRET = "ngo-connect-unit-test-secret";

const needService = require("../src/services/need.service");
const needLifecycleRepository = require("../src/repositories/needLifecycle.repository");
const pool = require("../src/config/database");
const needRepository = require("../src/repositories/need.repository");
const realFindPublicNeeds = needRepository.findPublicNeeds;
const ngoRepository = require("../src/repositories/ngo.repository");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");
const authorize = require("../src/middleware/role.middleware");
const validateRequest = require("../src/middleware/validation.middleware");
const needController = require("../src/controllers/need.controller");
const {
  needIdValidator,
  listNeedsValidator,
  createNeedValidator,
  updateNeedValidator,
} = require("../src/validators/need.validator");

const approvedUserId = "10000000-0000-4000-8000-000000000001";
const pendingUserId = "10000000-0000-4000-8000-000000000002";
const otherUserId = "10000000-0000-4000-8000-000000000003";
const causeId = "20000000-0000-4000-8000-000000000001";
const needId = "30000000-0000-4000-8000-000000000001";
const approvedNgoId = "40000000-0000-4000-8000-000000000001";
const pendingNgoId = "40000000-0000-4000-8000-000000000002";
const otherNgoId = "40000000-0000-4000-8000-000000000003";

let originalPoolQuery;
let repositoryCalls;
let records;

const testNeedInput = (overrides = {}) => ({
  causeId,
  title: "Community garden supplies",
  description: "Supplies for a neighborhood garden project.",
  contributionType: "MATERIAL",
  location: "Central Park",
  quantityRequired: 10,
  priority: "MEDIUM",
  deadline: "2099-10-20T12:00:00Z",
  status: "ACTIVE",
  ...overrides,
});

const tokenFor = (userId, role = "NGO") => jwt.sign({ userId, role }, process.env.JWT_SECRET);

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
  needLifecycleRepository.expireDueNeeds = async () => [];
  repositoryCalls = { create: 0, update: 0, list: 0, get: 0 };
  records = new Map();

  ngoRepository.findNgoByUserId = async (userId) => {
    if (userId === approvedUserId) return { ngo_id: approvedNgoId, verification_status: "APPROVED" };
    if (userId === pendingUserId) return { ngo_id: pendingNgoId, verification_status: "PENDING" };
    if (userId === otherUserId) return { ngo_id: otherNgoId, verification_status: "APPROVED" };
    return null;
  };

  needRepository.createNeed = async (data) => {
    repositoryCalls.create += 1;
    const created = { need_id: needId, ngo_id: data.ngoId, ...data, quantity_fulfilled: 0 };
    records.set(needId, created);
    return created;
  };
  needRepository.updateNeed = async (data) => {
    repositoryCalls.update += 1;
    const existing = records.get(data.needId);
    if (!existing || existing.ngo_id !== data.ngoId) return null;
    if (!["DRAFT", "ACTIVE"].includes(existing.status)) return null;
    if (existing.status === "ACTIVE" && data.status !== "ACTIVE") return null;
    if (data.quantityRequired !== null && data.quantityRequired < existing.quantity_fulfilled) {
      const error = new Error("check constraint violation");
      error.code = "23514";
      throw error;
    }
    const updated = { ...existing, ...data };
    records.set(data.needId, updated);
    return updated;
  };
  needRepository.findPublicNeeds = async (args) => {
    repositoryCalls.list += 1;
    return { items: [], total: 0, filters: args };
  };
  needRepository.findPublicNeedById = async (id) => {
    repositoryCalls.get += 1;
    return records.get(id) || null;
  };
});

test("creation derives NGO ownership and defaults absent optional fields", async () => {
  const created = await needService.createNeed(approvedUserId, testNeedInput({
    status: undefined, location: undefined, availability: undefined,
    quantityRequired: undefined, priority: undefined, deadline: undefined,
  }));

  assert.equal(created.ngo_id, approvedNgoId);
  assert.equal(created.status, "DRAFT");
  assert.equal(created.priority, "MEDIUM");
  assert.equal(created.quantity_fulfilled, 0);
  assert.equal(repositoryCalls.create, 1);
});

test("unapproved NGOs may save drafts but cannot publish active needs", async () => {
  await assert.rejects(
    needService.createNeed(pendingUserId, testNeedInput()),
    (error) => error.statusCode === 403
  );
  const draft = await needService.createNeed(pendingUserId, testNeedInput({ status: "DRAFT" }));
  assert.equal(draft.ngo_id, pendingNgoId);
  assert.equal(repositoryCalls.create, 1);
});

test("public list pagination is passed to the repository; database query encodes active visibility and deadline", async () => {
  const result = await needService.listNeeds({ limit: 25, offset: 50, search: "garden" });
  assert.deepEqual(result, { items: [], total: 0, filters: { limit: 25, offset: 50, search: "garden" } });
  assert.equal(repositoryCalls.list, 1);

  const pool = require("../src/config/database");
  originalPoolQuery = pool.query;
  let sql;
  let values;
  pool.query = async (query, parameters) => {
    sql = query;
    values = parameters;
    return { rows: [] };
  };
  try {
    await realFindPublicNeeds({ limit: 8, offset: 3, search: "book", causeId, contributionType: "MATERIAL", location: "Pune" });
  } finally {
    pool.query = originalPoolQuery;
  }
  assert.match(sql, /n\.status IN \('ACTIVE', 'PARTIALLY_FULFILLED'\)/);
  assert.match(sql, /g\.verification_status = 'APPROVED'/);
  assert.match(sql, /n\.deadline IS NULL OR n\.deadline > clock_timestamp\(\)/);
  assert.match(sql, /n\.moderation_status = 'VISIBLE'/);
  assert.match(sql, /u\.is_suspended = FALSE/);
  assert.match(sql, /position\(lower\(\$1\) in lower\(n\.title\)\)/);
  assert.match(sql, /position\(lower\(\$1\) in lower\(n\.description\)\)/);
  assert.match(sql, /n\.cause_id = \$2::uuid/);
  assert.match(sql, /n\.contribution_type = \$3/);
  assert.match(sql, /g\.city/);
  assert.deepEqual(values, ["book", causeId, "MATERIAL", "Pune", 8, 3]);
});

test("public need query parameterizes filters and uses one query for results and exact count", async () => {
  const originalQuery = pool.query;
  const injection = "%' OR TRUE --";
  let queryCount = 0;
  let values;
  pool.query = async (_sql, parameters) => {
    queryCount += 1;
    values = parameters;
    return { rows: [{ need_id: null, total_count: 7 }] };
  };
  try {
    const result = await realFindPublicNeeds({ search: injection, limit: 10, offset: 50 });
    assert.deepEqual(result, { items: [], total: 7 });
  } finally {
    pool.query = originalQuery;
  }
  assert.equal(queryCount, 1);
  assert.equal(values[0], injection);
  assert.deepEqual(values.slice(4), [10, 50]);
});

test("public need SQL reports material reservations and availability without exposing response rows", async () => {
  const originalQuery = pool.query;
  let sql;
  pool.query = async (query) => { sql = query; return { rows: [] }; };
  try {
    await realFindPublicNeeds({ limit: 10, offset: 0 });
  } finally {
    pool.query = originalQuery;
  }
  assert.match(sql, /AS quantity_reserved/);
  assert.match(sql, /AS quantity_available/);
  assert.match(sql, /r\.status IN \('ACCEPTED', 'IN_PROGRESS'\)/);
  assert.match(sql, /r\.contribution_type = 'MATERIAL'/);
  assert.doesNotMatch(sql, /SELECT .*contribution_id/);
});

test("UUID validators reject malformed IDs and accept valid UUIDs", async () => {
  const bad = await runValidators(needIdValidator, { params: { id: "bad-id" } });
  assert.equal(bad.valid, false);
  const good = await runValidators(needIdValidator, { params: { id: needId } });
  assert.equal(good.valid, true);
});

test("public search validators normalize supported filters and reject invalid input", async () => {
  const validators = require("../src/validators/need.validator").listNeedsValidator;
  const validReq = { query: { search: "  Library books ", causeId: causeId.toUpperCase(), contributionType: " material ", location: " Pune " }, params: {}, body: {} };
  const valid = await runValidators(validators, validReq);
  assert.equal(valid.valid, true);
  assert.equal(validReq.query.search, "Library books");
  assert.equal(validReq.query.causeId, causeId);
  assert.equal(validReq.query.contributionType, "MATERIAL");
  assert.equal(validReq.query.location, "Pune");

  const empty = { query: { search: "   ", location: "   " }, params: {}, body: {} };
  assert.equal((await runValidators(validators, empty)).valid, true);
  assert.equal(empty.query.search, null);
  assert.equal(empty.query.location, null);

  for (const query of [
    { causeId: "not-a-uuid" },
    { contributionType: "FOOD" },
    { search: "x".repeat(101) },
    { location: "x".repeat(101) },
    { search: ["books"] },
  ]) {
    assert.equal((await runValidators(validators, { query, params: {}, body: {} })).valid, false, JSON.stringify(query));
  }
});

test("creation validation enforces required fields, enum, quantity, date and allowed input fields", async () => {
  const valid = await runValidators(createNeedValidator, { body: testNeedInput() });
  assert.equal(valid.valid, true);

  const invalidCases = [
    testNeedInput({ contributionType: "FOOD" }),
    testNeedInput({ quantityRequired: 0 }),
    testNeedInput({ deadline: "2025-02-30T12:00:00Z" }),
    testNeedInput({ deadline: "2026-04-01T10:00:00" }),
    testNeedInput({ deadline: "2026-04-01" }),
    testNeedInput({ priority: "ASAP" }),
    testNeedInput({ status: "FULFILLED" }),
    testNeedInput({ ngoId: otherNgoId }),
    { title: "missing required fields" },
  ];

  for (const body of invalidCases) {
    const result = await runValidators(createNeedValidator, { body });
    assert.equal(result.valid, false, JSON.stringify(body));
  }
  assert.equal((await runValidators(createNeedValidator, { body: testNeedInput({ deadline: "2026-04-01T10:00:00+05:30" }) })).valid, true);

  const offsetValidators = require("../src/validators/need.validator").listNeedsValidator;
  const oversizedOffset = await runValidators(offsetValidators, {
    query: { offset: "2147483648" }, params: {}, body: {},
  });
  assert.equal(oversizedOffset.valid, false);
});

test("update authorization is scoped to the authenticated NGO and ACTIVE cannot return to DRAFT", async () => {
  records.set(needId, { need_id: needId, ngo_id: approvedNgoId, status: "ACTIVE", quantity_fulfilled: 0 });

  await assert.rejects(
    needService.updateNeed(otherUserId, needId, testNeedInput()),
    (error) => error.statusCode === 404
  );
  await assert.rejects(
    needService.updateNeed(approvedUserId, needId, testNeedInput({ status: "DRAFT" })),
    (error) => error.statusCode === 404
  );

  const updated = await needService.updateNeed(
    approvedUserId, needId, testNeedInput({ title: "Updated title" })
  );
  assert.equal(updated.title, "Updated title");
  assert.equal(repositoryCalls.update, 3);
});

test("need service maps database quantity integrity violations to a client error", async () => {
  records.set(needId, {
    need_id: needId, ngo_id: approvedNgoId, status: "ACTIVE", quantity_fulfilled: 8,
  });
  await assert.rejects(
    needService.updateNeed(approvedUserId, needId, testNeedInput({ quantityRequired: 5 })),
    (error) => error.statusCode === 400 && /quantity required/i.test(error.message)
  );
});

test("need service returns 409 when a quantity update conflicts with accepted material reservations", async () => {
  const originalUpdate = needRepository.updateNeed;
  needRepository.updateNeed = async () => ({ kind: "OVER_COMMITTED" });
  try {
    await assert.rejects(
      needService.updateNeed(approvedUserId, needId, testNeedInput({ quantityRequired: 5 })),
      (error) => error.statusCode === 409 && /fulfilled quantity plus accepted reservations/.test(error.message)
    );
  } finally {
    needRepository.updateNeed = originalUpdate;
  }
});

test("authentication and role middleware reject missing, invalid, and wrong-role credentials", () => {
  const noTokenRes = makeResponse();
  let continued = false;
  authenticate({ headers: {} }, noTokenRes, () => { continued = true; });
  assert.equal(noTokenRes.statusCode, 401);
  assert.equal(continued, false);

  const invalidTokenRes = makeResponse();
  authenticate({ headers: { authorization: "Bearer invalid" } }, invalidTokenRes, () => {});
  assert.equal(invalidTokenRes.statusCode, 401);

  const forbiddenRes = makeResponse();
  authorize("NGO")({ user: { role: "INDIVIDUAL" } }, forbiddenRes, () => { continued = true; });
  assert.equal(forbiddenRes.statusCode, 403);
});

test("need controller forwards service failures to centralized error handling", async () => {
  const originalGetNeed = needService.getNeed;
  const expectedError = new Error("Missing fixture");
  needService.getNeed = async () => { throw expectedError; };
  let forwarded;
  try {
    await needController.getById({ params: { id: needId } }, makeResponse(), (error) => { forwarded = error; });
  } finally {
    needService.getNeed = originalGetNeed;
  }
  assert.equal(forwarded, expectedError);
});

test("public list controller preserves items and adds total-aware pagination metadata", async () => {
  const originalListNeeds = needService.listNeeds;
  let filters;
  needService.listNeeds = async (input) => {
    filters = input;
    return { items: [{ need_id: needId }], total: 21 };
  };
  const res = makeResponse();
  try {
    await needController.list({ query: { limit: 10, offset: 10, search: "books", causeId } }, res, (error) => { throw error; });
  } finally {
    needService.listNeeds = originalListNeeds;
  }
  assert.deepEqual(filters, { limit: 10, offset: 10, search: "books", causeId, contributionType: null, location: null });
  assert.deepEqual(res.body.data, {
    items: [{ need_id: needId }],
    pagination: { limit: 10, offset: 10, total: 21, hasPrevious: true, hasNext: true },
  });
});

const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

process.env.JWT_SECRET = "ngo-connect-contribution-test-secret";

const pool = require("../src/config/database");
const contributionRepository = require("../src/repositories/contribution.repository");
const realCreateContribution = contributionRepository.createContribution;
const realFindContributionsForUser = contributionRepository.findContributionsForUser;
const realTransitionContribution = contributionRepository.transitionContribution;
const ngoRepository = require("../src/repositories/ngo.repository");
const needRepository = require("../src/repositories/need.repository");
const contributionService = require("../src/services/contribution.service");
const contributionController = require("../src/controllers/contribution.controller");
const contributionRoutes = require("../src/routes/contribution.routes");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");
const authorize = require("../src/middleware/role.middleware");
const validateRequest = require("../src/middleware/validation.middleware");
const {
  needIdValidator,
  contributionPathValidator,
  createContributionValidator,
  updateContributionStatusValidator,
} = require("../src/validators/contribution.validator");

const individualId = "10000000-0000-4000-8000-000000000001";
const ngoUserId = "10000000-0000-4000-8000-000000000002";
const otherNgoUserId = "10000000-0000-4000-8000-000000000003";
const needId = "20000000-0000-4000-8000-000000000001";
const contributionId = "30000000-0000-4000-8000-000000000001";
const ngoId = "40000000-0000-4000-8000-000000000001";

let calls;
let currentContributionStatus;

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
  calls = { create: 0, list: 0, mine: 0, transition: 0 };
  currentContributionStatus = "PENDING";
  ngoRepository.findNgoByUserId = async (userId) => {
    if (userId === ngoUserId) return { ngo_id: ngoId };
    if (userId === otherNgoUserId) return { ngo_id: "40000000-0000-4000-8000-000000000002" };
    return null;
  };
  needRepository.findNeedOwnerById = async (id) => id === needId ? { need_id: id, ngo_id: ngoId } : null;
  contributionRepository.createContribution = async (input) => {
    calls.create += 1;
    return { contribution_id: contributionId, status: "PENDING", ...input };
  };
  contributionRepository.findContributionsForNeed = async (id) => {
    calls.list += 1;
    return [{ contribution_id: contributionId, need_id: id, status: "PENDING" }];
  };
  contributionRepository.findContributionsForUser = async (userId) => {
    calls.mine += 1;
    return userId === individualId ? [{ contribution_id: contributionId, need_title: "Garden kits", ngo_name: "Green Future" }] : [];
  };
  contributionRepository.transitionContribution = async (input) => {
    calls.transition += 1;
    if (input.expectedStatus !== currentContributionStatus) return { kind: "CONFLICT" };
    currentContributionStatus = input.status;
    return { kind: "UPDATED", data: { contribution_id: contributionId, status: input.status } };
  };
});

test("individual contribution history is scoped to the authenticated user and supports an empty history", async () => {
  const own = await contributionService.listMyContributions(individualId);
  assert.equal(own.length, 1);
  assert.equal(own[0].need_title, "Garden kits");
  contributionRepository.findContributionsForUser = async () => {
    calls.mine += 1;
    return [];
  };
  assert.deepEqual(await contributionService.listMyContributions(individualId), []);
  assert.equal(calls.mine, 2);
});

test("individual history repository query is parameterized, sorted, and returns need and NGO display fields", async () => {
  const originalQuery = pool.query;
  let sql;
  let values;
  pool.query = async (query, parameters) => {
    sql = query;
    values = parameters;
    return { rows: [{ contribution_id: contributionId, need_title: "Garden kits", ngo_name: "Green Future" }] };
  };
  try {
    await realFindContributionsForUser(individualId);
  } finally {
    pool.query = originalQuery;
  }
  assert.deepEqual(values, [individualId]);
  assert.match(sql, /WHERE c\.user_id = \$1/);
  assert.match(sql, /JOIN needs n ON n\.need_id = c\.need_id/);
  assert.match(sql, /JOIN ngos g ON g\.ngo_id = n\.ngo_id/);
  assert.match(sql, /ORDER BY c\.created_at DESC/);
});

test("individual history route requires authentication and INDIVIDUAL role", () => {
  const layer = contributionRoutes.stack.find((entry) => entry.route?.path === "/users/me/contributions");
  assert.ok(layer);
  assert.equal(layer.route.methods.get, true);
  assert.equal(layer.route.stack[0].handle, authenticate);
  for (const role of ["NGO", "ADMIN"]) {
    const response = makeResponse();
    let continued = false;
    layer.route.stack[1].handle({ user: { role } }, response, () => { continued = true; });
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }
});

test("individual history controller derives scope from the authenticated user and returns the common envelope", async () => {
  const originalList = contributionService.listMyContributions;
  let calledWith;
  const response = makeResponse();
  try {
    contributionService.listMyContributions = async (userId) => {
      calledWith = userId;
      return [];
    };
    await contributionController.listForUser({ user: { userId: individualId }, body: { userId: otherNgoUserId } }, response, assert.fail);
  } finally {
    contributionService.listMyContributions = originalList;
  }
  assert.equal(calledWith, individualId);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.body, { success: true, message: "Your contributions were retrieved", data: [] });
});

test("contribution creation derives user identity and never accepts an arbitrary status", async () => {
  const contribution = await contributionService.createContribution(individualId, needId, {
    contributionType: "MATERIAL", description: "Garden soil", quantity: 4,
  });
  assert.equal(contribution.userId, individualId);
  assert.equal(contribution.status, "PENDING");
  assert.equal(calls.create, 1);
});

test("non-rejected contributions block another submission for every status", async () => {
  for (const status of ["PENDING", "ACCEPTED", "IN_PROGRESS", "COMPLETED"]) {
    contributionRepository.createContribution = async () => {
      const error = new Error("duplicate key");
      error.code = "23505";
      error.constraint = "uq_contributions_one_non_rejected_per_user_need";
      throw error;
    };
    await assert.rejects(
      contributionService.createContribution(individualId, needId, {
        contributionType: "MATERIAL", quantity: 1,
      }),
      (error) => error.statusCode === 409 && /already have a non-rejected contribution/.test(error.message),
      `a ${status} contribution must block another submission`
    );
  }
});

test("a rejected contribution allows the same individual to resubmit", async () => {
  contributionRepository.createContribution = async (input) => ({
    contribution_id: contributionId,
    status: "PENDING",
    ...input,
  });
  const result = await contributionService.createContribution(individualId, needId, {
    contributionType: "MATERIAL", quantity: 2,
  });
  assert.equal(result.status, "PENDING");
  assert.equal(result.userId, individualId);
});

test("different individuals can contribute to the same need", async () => {
  const inputs = [];
  contributionRepository.createContribution = async (input) => {
    inputs.push(input);
    return { contribution_id: `contribution-${inputs.length}`, status: "PENDING", ...input };
  };
  const first = await contributionService.createContribution(individualId, needId, {
    contributionType: "MATERIAL", quantity: 1,
  });
  const second = await contributionService.createContribution("10000000-0000-4000-8000-000000000099", needId, {
    contributionType: "MATERIAL", quantity: 1,
  });
  assert.notEqual(first.userId, second.userId);
  assert.equal(inputs.every((input) => input.needId === needId), true);
});

test("concurrent repository duplicate conflicts result in at most one successful submission", async () => {
  let inserted = false;
  contributionRepository.createContribution = async (input) => {
    if (inserted) {
      const error = new Error("duplicate key");
      error.code = "23505";
      error.constraint = "uq_contributions_one_non_rejected_per_user_need";
      throw error;
    }
    inserted = true;
    return { contribution_id: contributionId, status: "PENDING", ...input };
  };
  const results = await Promise.allSettled([
    contributionService.createContribution(individualId, needId, { contributionType: "MATERIAL", quantity: 1 }),
    contributionService.createContribution(individualId, needId, { contributionType: "MATERIAL", quantity: 1 }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find((result) => result.status === "rejected");
  assert.equal(rejected.reason.statusCode, 409);
});

test("duplicate contribution index migration preserves rejected history and guards existing duplicates", () => {
  const migration = fs.readFileSync(
    path.join(__dirname, "../../database/migrations/002_one_non_rejected_contribution_per_need.sql"),
    "utf8"
  );
  assert.match(migration, /GROUP BY need_id, user_id\s+HAVING COUNT\(\*\) > 1/);
  assert.match(migration, /CREATE UNIQUE INDEX uq_contributions_one_non_rejected_per_user_need\s+ON contributions\s*\(need_id, user_id\)\s+WHERE status IN \('PENDING', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED'\)/);
  assert.doesNotMatch(migration, /WHERE status IN \([^)]*'REJECTED'/);
});

test("ineligible or mismatched needs return 404", async () => {
  contributionRepository.createContribution = async () => null;
  await assert.rejects(
    contributionService.createContribution(individualId, needId, { contributionType: "MATERIAL", quantity: 1 }),
    (error) => error.statusCode === 404
  );
});

test("only the owning NGO can list contributions for an existing need", async () => {
  const contributions = await contributionService.listNeedContributions(ngoUserId, needId);
  assert.equal(contributions.length, 1);
  await assert.rejects(
    contributionService.listNeedContributions(otherNgoUserId, needId),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    contributionService.listNeedContributions(ngoUserId, "20000000-0000-4000-8000-000000000099"),
    (error) => error.statusCode === 404
  );
  assert.equal(calls.list, 1);
});

test("NGO status workflow permits pending decisions and forward-only progress", async () => {
  assert.equal((await contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "ACCEPTED")).status, "ACCEPTED");
  assert.equal((await contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "IN_PROGRESS")).status, "IN_PROGRESS");
  assert.equal((await contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "COMPLETED")).status, "COMPLETED");

  currentContributionStatus = "PENDING";
  assert.equal((await contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "REJECTED")).status, "REJECTED");
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "ACCEPTED"),
    (error) => error.statusCode === 409
  );
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "PENDING"),
    (error) => error.statusCode === 400
  );
});

test("contribution transition outcomes map ownership, missing resources, and over-fulfillment safely", async () => {
  contributionRepository.transitionContribution = async () => ({ kind: "FORBIDDEN" });
  await assert.rejects(
    contributionService.updateContributionStatus(otherNgoUserId, needId, contributionId, "ACCEPTED"),
    (error) => error.statusCode === 403
  );
  contributionRepository.transitionContribution = async () => ({ kind: "NOT_FOUND" });
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "ACCEPTED"),
    (error) => error.statusCode === 404
  );
  contributionRepository.transitionContribution = async () => ({ kind: "OVER_FULFILLED" });
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "COMPLETED"),
    (error) => error.statusCode === 409
  );
  contributionRepository.transitionContribution = async () => ({ kind: "NOT_FULFILLABLE" });
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "COMPLETED"),
    (error) => error.statusCode === 409
  );
});

test("creation validation enforces type-specific fields, limits, and allowlist", async () => {
  const validCases = [
    { contributionType: "MATERIAL", quantity: 1 },
    { contributionType: "SKILL", description: "Can help with bookkeeping" },
  ];
  for (const body of validCases) {
    assert.equal((await runValidators(createContributionValidator, { body, params: { needId } })).valid, true);
  }

  const invalidCases = [
    { contributionType: "VOLUNTEER", quantity: 1 },
    { contributionType: "MONEY", amount: 12.34 },
    { contributionType: "MATERIAL" },
    { contributionType: "MATERIAL", quantity: 1, amount: 1 },
    { contributionType: "MONEY", quantity: 1, amount: 1 },
    { contributionType: "MONEY", amount: 0 },
    { contributionType: "MONEY", amount: 1.239 },
    { contributionType: "MONEY", amount: 10000000000 },
    { contributionType: "SKILL", quantity: 1 },
    { contributionType: "SKILL", amount: 2 },
    { contributionType: "MATERIAL", quantity: 1, userId: individualId },
  ];
  for (const body of invalidCases) {
    assert.equal((await runValidators(createContributionValidator, { body, params: { needId } })).valid, false, JSON.stringify(body));
  }
});

test("money contribution submissions are rejected in favor of external NGO support", async () => {
  await assert.rejects(
    contributionService.createContribution(individualId, needId, { contributionType: "MONEY", amount: 25 }),
    (error) => error.statusCode === 400 && /arranged directly with the NGO/.test(error.message)
  );
  assert.equal(calls.create, 0);
});

test("HTTP contribution route returns the external-support message before generic payload validation", () => {
  const route = contributionRoutes.stack.find((layer) => layer.route?.path === "/needs/:needId/contributions")?.route;
  assert.ok(route);
  const middleware = route.stack.find((layer) => layer.handle.name === "rejectMoneyContribution")?.handle;
  assert.equal(typeof middleware, "function");
  let forwarded;
  middleware({ body: { contributionType: "MONEY", amount: 10 } }, {}, (error) => { forwarded = error; });
  assert.equal(forwarded.statusCode, 400);
  assert.match(forwarded.message, /arranged directly with the NGO/);
  let continued = false;
  middleware({ body: { contributionType: "MATERIAL" } }, {}, (error) => { assert.ifError(error); continued = true; });
  assert.equal(continued, true);
});

test("historical money contributions cannot enter the NGO in-platform status workflow", async () => {
  contributionRepository.transitionContribution = async () => ({ kind: "EXTERNAL_SUPPORT_ONLY" });
  await assert.rejects(
    contributionService.updateContributionStatus(ngoUserId, needId, contributionId, "ACCEPTED"),
    (error) => error.statusCode === 409 && /Historical money records are read-only/.test(error.message)
  );
});

test("reservation aggregate counts only accepted and in-progress material contributions", async () => {
  const originalQuery = pool.query;
  let sql;
  let values;
  pool.query = async (query, params) => {
    sql = query;
    values = params;
    return { rows: [{ reserved_quantity: "7" }] };
  };
  try {
    assert.equal(await contributionRepository.findReservedMaterialQuantity(pool, needId), 7);
    assert.equal(await contributionRepository.findReservedMaterialQuantity(pool, needId, contributionId), 7);
  } finally {
    pool.query = originalQuery;
  }
  assert.match(sql, /contribution_type = 'MATERIAL'/);
  assert.match(sql, /status IN \('ACCEPTED', 'IN_PROGRESS'\)/);
  assert.deepEqual(values, [needId, contributionId]);
});

test("path and status validators restrict UUIDs and client-selected statuses", async () => {
  assert.equal((await runValidators(needIdValidator, { params: { needId }, body: {} })).valid, true);
  assert.equal((await runValidators(contributionPathValidator, { params: { needId, contributionId }, body: {} })).valid, true);
  assert.equal((await runValidators(contributionPathValidator, { params: { needId, contributionId: "bad" }, body: {} })).valid, false);
  for (const status of ["PENDING", "CANCELLED", "COMPLETED_BY_USER"]) {
    assert.equal((await runValidators(updateContributionStatusValidator, { params: {}, body: { status } })).valid, false);
  }
  for (const status of ["ACCEPTED", "REJECTED", "IN_PROGRESS", "COMPLETED"]) {
    assert.equal((await runValidators(updateContributionStatusValidator, { params: {}, body: { status } })).valid, true);
  }
  assert.equal((await runValidators(updateContributionStatusValidator, { params: {}, body: { status: "ACCEPTED", userId: individualId } })).valid, false);
});

test("authentication and role middleware deny missing, invalid, and wrong-role tokens", async () => {
  const missing = makeResponse();
  authenticate({ headers: {} }, missing, () => assert.fail("must not continue"));
  assert.equal(missing.statusCode, 401);

  const invalid = makeResponse();
  authenticate({ headers: { authorization: "Bearer invalid" } }, invalid, () => {});
  assert.equal(invalid.statusCode, 401);

  const denied = makeResponse();
  authorize("INDIVIDUAL")({ user: { role: "NGO" } }, denied, () => assert.fail("must not continue"));
  assert.equal(denied.statusCode, 403);

  const allowed = makeResponse();
  const token = jwt.sign({ userId: individualId, role: "INDIVIDUAL" }, process.env.JWT_SECRET);
  const originalStatus = userRepository.findAuthStatusById;
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: false });
  let continued = false;
  await authenticate({ headers: { authorization: `Bearer ${token}` } }, allowed, () => { continued = true; });
  userRepository.findAuthStatusById = originalStatus;
  assert.equal(continued, true);
});

test("repository uses transactions, row locks, and a conditional need fulfillment update", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push({ sql: normalized, values });
      if (normalized.startsWith("SELECT n.need_id, n.ngo_id")) {
        return { rows: [{ need_id: needId, ngo_id: ngoId, contribution_type: "MATERIAL", quantity_required: 5, quantity_fulfilled: 2, need_status: "PARTIALLY_FULFILLED", ngo_user_id: ngoUserId }] };
      }
      if (normalized.startsWith("SELECT contribution_id, need_id")) {
        return { rows: [{ contribution_id: contributionId, need_id: needId, contribution_type: "MATERIAL", quantity: 3, status: "IN_PROGRESS" }] };
      }
      if (normalized.startsWith("UPDATE contributions")) {
        return { rows: [{ contribution_id: contributionId, status: "COMPLETED" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realTransitionContribution({
      needId, contributionId, userId: ngoUserId, ngoId, expectedStatus: "IN_PROGRESS", status: "COMPLETED",
    });
    assert.equal(result.kind, "UPDATED");
  } finally {
    pool.connect = originalConnect;
  }

  assert.ok(statements.some(({ sql }) => sql === "BEGIN"));
  assert.ok(statements.some(({ sql }) => sql.includes("FOR UPDATE OF n")));
  assert.ok(statements.some(({ sql }) => sql.includes("FROM contributions") && sql.endsWith("FOR UPDATE")));
  const needUpdate = statements.find(({ sql }) => sql.startsWith("UPDATE needs"));
  assert.ok(needUpdate);
  assert.match(needUpdate.sql, /quantity_fulfilled = \$2/);
  assert.match(needUpdate.sql, /WHEN \$2 >= quantity_required THEN 'COMPLETED'/);
  assert.match(needUpdate.sql, /completed_at = CASE/);
  assert.deepEqual(needUpdate.values, [needId, 5]);
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
});

test("rejected contribution attempt commits the due-need expiry transition", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realCreateContribution({
      needId, userId: individualId, contributionType: "MATERIAL", description: "late", quantity: 1, amount: null,
    });
    assert.equal(result, null);
  } finally {
    pool.connect = originalConnect;
  }
  assert.ok(statements.some((sql) => sql.startsWith("WITH due AS")));
  assert.ok(statements.includes("COMMIT"));
  assert.ok(!statements.includes("ROLLBACK"));
  assert.ok(!statements.some((sql) => sql.startsWith("INSERT INTO contributions")));
});

test("repository does not transition historical MONEY records", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT n.need_id, n.ngo_id")) {
        return { rows: [{ need_id: needId, ngo_id: ngoId, contribution_type: "MATERIAL", quantity_required: 5, quantity_fulfilled: 0, need_status: "ACTIVE", ngo_user_id: ngoUserId }] };
      }
      if (normalized.startsWith("SELECT contribution_id, need_id")) {
        return { rows: [{ contribution_id: contributionId, need_id: needId, contribution_type: "MONEY", quantity: null, status: "PENDING" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realTransitionContribution({
      needId, contributionId, userId: ngoUserId, ngoId, expectedStatus: "PENDING", status: "ACCEPTED",
    });
    assert.equal(result.kind, "EXTERNAL_SUPPORT_ONLY");
  } finally {
    pool.connect = originalConnect;
  }
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.some((sql) => sql.startsWith("UPDATE contributions")));
});

test("repository rejects acceptance that exceeds fulfilled plus accepted and in-progress reservations", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT n.need_id, n.ngo_id")) {
        return { rows: [{ need_id: needId, ngo_id: ngoId, contribution_type: "MATERIAL", quantity_required: 5, quantity_fulfilled: 1, need_status: "ACTIVE", ngo_user_id: ngoUserId }] };
      }
      if (normalized.startsWith("SELECT contribution_id, need_id")) {
        return { rows: [{ contribution_id: contributionId, need_id: needId, contribution_type: "MATERIAL", quantity: 2, status: "PENDING" }] };
      }
      if (normalized.startsWith("SELECT COALESCE(SUM(quantity)")) return { rows: [{ reserved_quantity: "3" }] };
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realTransitionContribution({
      needId, contributionId, userId: ngoUserId, ngoId, expectedStatus: "PENDING", status: "ACCEPTED",
    });
    assert.equal(result.kind, "OVER_COMMITTED");
  } finally {
    pool.connect = originalConnect;
  }
  assert.ok(statements.some((sql) => sql.includes("FOR UPDATE OF n")));
  assert.ok(statements.some((sql) => sql.includes("status IN ('ACCEPTED', 'IN_PROGRESS')")));
  assert.ok(statements.includes("ROLLBACK"));
  assert.ok(!statements.some((sql) => sql.startsWith("UPDATE contributions")));
});

test("creation locks an eligible matching need and inserts only authenticated user data", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql, values = []) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push({ sql: normalized, values });
      if (normalized.startsWith("SELECT n.need_id FROM needs n")) return { rows: [{ need_id: needId }] };
      if (normalized.startsWith("INSERT INTO contributions")) {
        return { rows: [{ contribution_id: contributionId, user_id: individualId, status: "PENDING" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realCreateContribution({
      needId, userId: individualId, contributionType: "MATERIAL", description: "Supplies", quantity: 3, amount: null,
    });
    assert.equal(result.status, "PENDING");
  } finally {
    pool.connect = originalConnect;
  }

  const needLock = statements.find(({ sql }) => sql.startsWith("SELECT n.need_id FROM needs n"));
  assert.match(needLock.sql, /status IN \('ACTIVE', 'PARTIALLY_FULFILLED'\)/);
  assert.match(needLock.sql, /g\.verification_status = 'APPROVED'/);
  assert.match(needLock.sql, /n\.deadline IS NULL OR n\.deadline > clock_timestamp\(\)/);
  assert.match(needLock.sql, /contribution_type = \$2/);
  assert.match(needLock.sql, /FOR UPDATE/);
  assert.deepEqual(needLock.values, [needId, "MATERIAL"]);
  const insertion = statements.find(({ sql }) => sql.startsWith("INSERT INTO contributions"));
  assert.deepEqual(insertion.values, [needId, individualId, "MATERIAL", "Supplies", 3, null]);
  assert.ok(statements.some(({ sql }) => sql === "COMMIT"));
});

test("repository rolls back when the active contribution unique index rejects an insert", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT n.need_id FROM needs n")) return { rows: [{ need_id: needId }] };
      if (normalized.startsWith("INSERT INTO contributions")) {
        const error = new Error("duplicate key");
        error.code = "23505";
        error.constraint = "uq_contributions_one_non_rejected_per_user_need";
        throw error;
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    await assert.rejects(
      realCreateContribution({ needId, userId: individualId, contributionType: "MATERIAL", description: null, quantity: 1, amount: null }),
      (error) => error.code === "23505" && error.constraint === "uq_contributions_one_non_rejected_per_user_need"
    );
  } finally {
    pool.connect = originalConnect;
  }
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.includes("COMMIT"), false);
});

test("repository rolls back material completion that would over-fulfill", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push(normalized);
      if (normalized.startsWith("SELECT n.need_id, n.ngo_id")) {
        return { rows: [{ need_id: needId, ngo_id: ngoId, contribution_type: "MATERIAL", quantity_required: 4, quantity_fulfilled: 2, need_status: "PARTIALLY_FULFILLED", ngo_user_id: ngoUserId }] };
      }
      if (normalized.startsWith("SELECT contribution_id, need_id")) {
        return { rows: [{ contribution_id: contributionId, need_id: needId, contribution_type: "MATERIAL", quantity: 3, status: "IN_PROGRESS" }] };
      }
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;
  try {
    const result = await realTransitionContribution({
      needId, contributionId, userId: ngoUserId, ngoId, expectedStatus: "IN_PROGRESS", status: "COMPLETED",
    });
    assert.equal(result.kind, "OVER_FULFILLED");
  } finally {
    pool.connect = originalConnect;
  }
  assert.ok(statements.includes("ROLLBACK"));
  assert.equal(statements.some((sql) => sql.startsWith("UPDATE needs")), false);
  assert.equal(statements.some((sql) => sql.startsWith("UPDATE contributions")), false);
});

test("controller responds in the common envelope and forwards service errors", async () => {
  const originalCreate = contributionService.createContribution;
  let forwarded;
  const response = makeResponse();
  try {
    contributionService.createContribution = async (userId, id, body) => ({ contribution_id: contributionId, userId, id, ...body });
    await contributionController.create({
      user: { userId: individualId }, params: { needId }, body: { contributionType: "MATERIAL", quantity: 2 },
    }, response, (error) => { forwarded = error; });
    assert.equal(response.statusCode, 201);
    assert.equal(response.body.success, true);
    assert.equal(response.body.data.userId, individualId);

    const expectedError = new Error("failure");
    contributionService.createContribution = async () => { throw expectedError; };
    await contributionController.create({ user: { userId: individualId }, params: { needId }, body: {} }, makeResponse(), (error) => { forwarded = error; });
    assert.equal(forwarded, expectedError);
  } finally {
    contributionService.createContribution = originalCreate;
  }
});

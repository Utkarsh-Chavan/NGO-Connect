const { beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const jwt = require("jsonwebtoken");
const { validationResult } = require("express-validator");

process.env.JWT_SECRET = "ngo-connect-admin-test-secret";

const pool = require("../src/config/database");
const ngoRepository = require("../src/repositories/ngo.repository");
const needRepository = require("../src/repositories/need.repository");
const userRepository = require("../src/repositories/user.repository");
const ngoService = require("../src/services/ngo.service");
const needService = require("../src/services/need.service");
const authenticate = require("../src/middleware/auth.middleware");
const authorize = require("../src/middleware/role.middleware");
const validateRequest = require("../src/middleware/validation.middleware");
const { listPendingNgosValidator, verifyNgoValidator } = require("../src/validators/admin.validator");

const ngoId = "40000000-0000-4000-8000-000000000001";
const adminId = "40000000-0000-4000-8000-000000000002";
const pendingUserId = "40000000-0000-4000-8000-000000000003";
const approvedUserId = "40000000-0000-4000-8000-000000000004";

const originals = {
  findPendingNgos: ngoRepository.findPendingNgos,
  updateNgoVerificationStatus: ngoRepository.updateNgoVerificationStatus,
  findNgoByUserId: ngoRepository.findNgoByUserId,
  createNeed: needRepository.createNeed,
  updateNeed: needRepository.updateNeed,
};

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
  const response = makeResponse();
  let continued = false;
  validateRequest(req, response, () => { continued = true; });
  return { valid: continued, response, errors: validationResult(req).array() };
};

const withFakeTransactionPool = ({ currentSubmission = true, failOnHistory = false } = {}) => {
  const originalConnect = pool.connect;
  const statements = [];
  const state = {
    ngoStatus: "PENDING",
    submissionStatus: currentSubmission ? "PENDING" : null,
    history: [],
    released: false,
  };
  let transactionSnapshot;

  pool.connect = async () => ({
    query: async (sql, values = []) => {
      const normalized = sql.replace(/\s+/g, " ").trim();
      statements.push({ sql: normalized, values });

      if (normalized === "BEGIN") {
        transactionSnapshot = {
          ngoStatus: state.ngoStatus,
          submissionStatus: state.submissionStatus,
          history: [...state.history],
        };
        return { rows: [] };
      }
      if (normalized.startsWith("SELECT ngo_id, user_id, name, verification_status FROM ngos")) {
        return { rows: [{ ngo_id: ngoId, user_id: "40000000-0000-4000-8000-000000000005", name: "Legacy Aid", verification_status: state.ngoStatus }] };
      }
      if (normalized.startsWith("SELECT submission_id, status FROM ngo_verification_submissions")) {
        return {
          rows: currentSubmission
            ? [{ submission_id: "submission-1", status: state.submissionStatus, legacy_import: true }]
            : [],
        };
      }
      if (normalized.startsWith("SELECT EXISTS (")) {
        return { rows: [{ has_registration_certificate: true }] };
      }
      if (normalized.startsWith("SELECT name FROM users")) return { rows: [{ name: "Admin Actor" }] };
      if (normalized.startsWith("UPDATE ngos")) {
        state.ngoStatus = values[1];
        return { rows: [{ ngo_id: ngoId, name: "Legacy Aid", verification_status: values[1] }] };
      }
      if (normalized.startsWith("UPDATE ngo_verification_submissions")) {
        state.submissionStatus = values[1];
        return { rows: [{ submission_id: values[0] }] };
      }
      if (normalized.startsWith("INSERT INTO ngo_verification_history")) {
        if (failOnHistory) throw new Error("simulated history insert failure");
        state.history.push(values);
        return { rows: [] };
      }
      if (normalized.startsWith("INSERT INTO notifications")) return { rows: [], rowCount: 1 };
      if (normalized === "COMMIT") return { rows: [] };
      if (normalized === "ROLLBACK") {
        Object.assign(state, transactionSnapshot);
        return { rows: [] };
      }
      throw new Error(`Unexpected SQL in fake transaction: ${normalized}`);
    },
    release: () => { state.released = true; },
  });

  return {
    state,
    statements,
    restore: () => { pool.connect = originalConnect; },
  };
};

beforeEach(() => {
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: false });
  Object.assign(ngoRepository, {
    findPendingNgos: originals.findPendingNgos,
    updateNgoVerificationStatus: originals.updateNgoVerificationStatus,
    findNgoByUserId: originals.findNgoByUserId,
  });
  Object.assign(needRepository, {
    createNeed: originals.createNeed,
    updateNeed: originals.updateNeed,
  });
});

test("admin authorization rejects missing/invalid tokens and non-admin roles", async () => {
  const missing = makeResponse();
  authenticate({ headers: {} }, missing, () => assert.fail("missing token must be denied"));
  assert.equal(missing.statusCode, 401);

  const invalid = makeResponse();
  authenticate({ headers: { authorization: "Bearer invalid" } }, invalid, () => assert.fail("invalid token must be denied"));
  assert.equal(invalid.statusCode, 401);

  const forbidden = makeResponse();
  authorize("ADMIN")({ user: { role: "NGO" } }, forbidden, () => assert.fail("non-admin must be denied"));
  assert.equal(forbidden.statusCode, 403);

  const token = jwt.sign({ userId: adminId, role: "ADMIN" }, process.env.JWT_SECRET);
  const request = { headers: { authorization: `Bearer ${token}` } };
  await authenticate(request, makeResponse(), () => {});
  let continued = false;
  authorize("ADMIN")(request, makeResponse(), () => { continued = true; });
  assert.equal(continued, true);
});

test("admin validators constrain pagination, UUIDs, decisions, and body fields", async () => {
  const pending = await runValidators(listPendingNgosValidator, { query: { limit: "25", offset: "0" } });
  assert.equal(pending.valid, true);

  const invalidPagination = await runValidators(listPendingNgosValidator, { query: { limit: "500" } });
  assert.equal(invalidPagination.valid, false);

  const validDecision = await runValidators(verifyNgoValidator, {
    params: { ngoId }, body: { verificationStatus: "APPROVED" },
  });
  assert.equal(validDecision.valid, true);

  const decisionWithMessage = await runValidators(verifyNgoValidator, {
    params: { ngoId }, body: { verificationStatus: "REJECTED", message: "Please clarify registration details." },
  });
  assert.equal(decisionWithMessage.valid, true);

  for (const body of [
    { verificationStatus: "PENDING" },
    { verificationStatus: "APPROVED", userId: adminId },
    { verification_status: "REJECTED" },
  ]) {
    const invalid = await runValidators(verifyNgoValidator, { params: { ngoId }, body });
    assert.equal(invalid.valid, false);
  }

  const invalidUuid = await runValidators(verifyNgoValidator, {
    params: { ngoId: "not-a-uuid" }, body: { verificationStatus: "REJECTED" },
  });
  assert.equal(invalidUuid.valid, false);
});

test("verification service preserves the admin API and returns 404 for a missing NGO", async () => {
  const originalUpdate = ngoRepository.updateNgoVerificationStatus;
  let received;
  try {
    ngoRepository.updateNgoVerificationStatus = async (input) => {
      received = input;
      return { ngo_id: input.ngoId, verification_status: input.verificationStatus };
    };
    assert.deepEqual(await ngoService.verifyNgoProfile(ngoId, "APPROVED"), {
      ngo_id: ngoId, verification_status: "APPROVED",
    });
    assert.deepEqual(received, {
      ngoId, verificationStatus: "APPROVED", adminUserId: undefined, message: undefined,
    });
    assert.deepEqual(await ngoService.verifyNgoProfile(ngoId, "REJECTED", adminId, "Decision reason"), {
      ngo_id: ngoId, verification_status: "REJECTED",
    });
    await assert.rejects(ngoService.verifyNgoProfile(ngoId, "PENDING"), (error) => error.statusCode === 400);
    ngoRepository.updateNgoVerificationStatus = async () => null;
    await assert.rejects(ngoService.verifyNgoProfile(ngoId, "APPROVED"), (error) => error.statusCode === 404);
  } finally {
    ngoRepository.updateNgoVerificationStatus = originalUpdate;
  }
});

test("admin decisions transactionally update NGO, current legacy submission, and audit history", async () => {
  const originalQuery = pool.query;
  const calls = [];
  const transactionStatements = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ ngo_id: ngoId, verification_status: "PENDING" }] };
  };
  try {
    await originals.findPendingNgos({ limit: 10, offset: 5 });
    for (const decision of ["APPROVED", "REJECTED"]) {
      const transaction = withFakeTransactionPool();
      const result = await originals.updateNgoVerificationStatus({
        ngoId,
        verificationStatus: decision,
        adminUserId: adminId,
        message: `Reason for ${decision.toLowerCase()}`,
      });
      assert.equal(result.verification_status, decision);
      assert.equal(transaction.state.ngoStatus, decision);
      assert.equal(transaction.state.submissionStatus, decision);
      const event = transaction.state.history.at(-1);
      assert.deepEqual(event, [ngoId, "Legacy Aid", decision, "submission-1", adminId, "Admin Actor", decision, `Reason for ${decision.toLowerCase()}`]);
      transactionStatements.push(...transaction.statements);
      transaction.restore();
    }
  } finally {
    pool.query = originalQuery;
  }
  assert.deepEqual(calls[0].values, [10, 5]);
  assert.match(calls[0].sql, /verification_status = 'PENDING'/);
  const statements = transactionStatements;
  assert.ok(statements.some(({ sql, values }) => sql.startsWith("UPDATE ngos") && values[0] === ngoId));
  assert.ok(statements.some(({ sql, values }) =>
    sql.startsWith("UPDATE ngo_verification_submissions")
      && /is_current = TRUE/.test(sql)
      && values[0] === "submission-1"
  ));
  assert.ok(statements.some(({ sql, values }) => sql.startsWith("INSERT INTO ngo_verification_history") && values[4] === adminId));
  assert.equal(statements.filter(({ sql }) => sql === "COMMIT").length, 2);
  assert.ok(statements.some(({ sql }) => /legacy_import/.test(sql) === false && /is_current = TRUE/.test(sql)));
  assert.doesNotMatch(statements.map(({ sql }) => sql).join(" "), /password_hash/i);
});

test("admin cannot decide a profile without a current submission", async () => {
  const transaction = withFakeTransactionPool({ currentSubmission: false });
  try {
    await assert.rejects(
      originals.updateNgoVerificationStatus({ ngoId, verificationStatus: "APPROVED", adminUserId: adminId }),
      (error) => error.statusCode === 409 && error.publicCode === "CURRENT_SUBMISSION_REQUIRED"
    );
    assert.equal(transaction.state.ngoStatus, "PENDING");
    assert.equal(transaction.state.history.length, 0);
    assert.ok(transaction.statements.some(({ sql }) => sql === "ROLLBACK"));
    assert.ok(!transaction.statements.some(({ sql }) => sql.startsWith("UPDATE ngos")));
  } finally {
    transaction.restore();
  }
});

test("admin decision rolls back NGO and submission updates if history insertion fails", async () => {
  const transaction = withFakeTransactionPool({ failOnHistory: true });
  try {
    await assert.rejects(
      originals.updateNgoVerificationStatus({ ngoId, verificationStatus: "APPROVED", adminUserId: adminId }),
      /simulated history insert failure/
    );
    assert.equal(transaction.state.ngoStatus, "PENDING");
    assert.equal(transaction.state.submissionStatus, "PENDING");
    assert.equal(transaction.state.history.length, 0);
    assert.ok(transaction.statements.some(({ sql }) => sql === "ROLLBACK"));
    assert.equal(transaction.state.released, true);
  } finally {
    transaction.restore();
  }
});

test("need publication reads current verification from the repository and SQL independently gates ACTIVE", async () => {
  const originalFindNgo = ngoRepository.findNgoByUserId;
  const originalCreateNeed = needRepository.createNeed;
  try {
    let currentStatus = "PENDING";
    ngoRepository.findNgoByUserId = async (userId) => ({ ngo_id: ngoId, verification_status: currentStatus, user_id: userId });
    needRepository.createNeed = async () => ({ need_id: "need-id", status: "ACTIVE" });

    await assert.rejects(
      needService.createNeed(pendingUserId, { status: "ACTIVE" }),
      (error) => error.statusCode === 403
    );
    currentStatus = "APPROVED";
    assert.equal((await needService.createNeed(approvedUserId, { status: "ACTIVE" })).status, "ACTIVE");

    const originalConnect = pool.connect;
    let sql;
    let values;
    pool.connect = async () => ({
      query: async (query, params) => {
        const normalized = query.replace(/\s+/g, " ").trim();
        if (normalized.startsWith("INSERT INTO needs")) { sql = query; values = params; }
        return { rows: [] };
      },
      release() {},
    });
    try {
      await originals.createNeed({
        ngoId, causeId: "20000000-0000-4000-8000-000000000001", title: "Need", description: "Details", contributionType: "MATERIAL",
        location: null, availability: null, quantityRequired: 1, priority: "MEDIUM", deadline: null, status: "ACTIVE",
      });
    } finally {
      pool.connect = originalConnect;
    }
    assert.match(sql, /g\.verification_status = 'APPROVED'/);
    assert.match(sql, /\$11::varchar <> 'ACTIVE'/);
    assert.match(sql, /SELECT \$1, c\.cause_id, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11::varchar/);
    assert.equal(values[0], ngoId);
    assert.equal(values.at(-1), "ACTIVE");
  } finally {
    ngoRepository.findNgoByUserId = originalFindNgo;
    needRepository.createNeed = originalCreateNeed;
  }
});

test("need update SQL pins the status parameter type in assignments and lifecycle predicates", async () => {
  const originalConnect = pool.connect;
  let sql;
  const client = {
    async query(query) {
      if (/SELECT need_id, contribution_type, quantity_fulfilled(?:, status)? FROM needs/.test(query.replace(/\s+/g, " "))) {
        return { rows: [{ need_id: "30000000-0000-4000-8000-000000000001", contribution_type: "MATERIAL", quantity_fulfilled: 0 }] };
      }
      if (query.includes("SELECT COALESCE(SUM(quantity)")) return { rows: [{ reserved_quantity: 0 }] };
      if (query.replace(/\s+/g, " ").trim().startsWith("UPDATE needs n")) sql = query;
      return { rows: [] };
    },
    release() {},
  };
  pool.connect = async () => client;

  try {
    await originals.updateNeed({
      needId: "30000000-0000-4000-8000-000000000001",
      ngoId,
      causeId: "20000000-0000-4000-8000-000000000001",
      title: "Need",
      description: "Details",
      contributionType: "MATERIAL",
      location: null,
      availability: null,
      quantityRequired: 1,
      priority: "MEDIUM",
      deadline: null,
      status: "ACTIVE",
    });
  } finally {
    pool.connect = originalConnect;
  }

  assert.match(sql, /status = \$11::varchar/);
  assert.match(sql, /\$11::varchar <> 'ACTIVE'/);
  assert.match(sql, /\$11::varchar = 'ACTIVE'/);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const pool = require("../src/config/database");
const repository = require("../src/repositories/adminWorkspace.repository");
const service = require("../src/services/adminWorkspace.service");
const needLifecycleRepository = require("../src/repositories/needLifecycle.repository");
const route = require("../src/routes/admin.routes");
const authenticate = require("../src/middleware/auth.middleware");
const userRepository = require("../src/repositories/user.repository");
const jwt = require("jsonwebtoken");
const { userStatus, needModeration } = require("../src/validators/adminWorkspace.validator");
const { validationResult } = require("express-validator");
const fs = require("node:fs");
const path = require("node:path");

const runValidation = async (validators, req) => {
  for (const validator of validators) await new Promise((resolve, reject) => validator(req, {}, (e) => e ? reject(e) : resolve()));
  return validationResult(req).array();
};

test("every Admin API route authenticates and authorizes ADMIN on the backend", () => {
  const admin = route.stack.filter((layer) => layer.route);
  assert.ok(admin.length >= 15);
  for (const layer of admin) {
    assert.equal(layer.route.stack[0].handle, authenticate, layer.route.path);
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    let continued = false;
    layer.route.stack[1].handle({ user: { role: "INDIVIDUAL" } }, response, () => { continued = true; });
    assert.equal(response.statusCode, 403, layer.route.path);
    assert.equal(continued, false, layer.route.path);
  }
});

test("suspended accounts lose existing JWT access", async () => {
  const originalStatus = userRepository.findAuthStatusById;
  process.env.JWT_SECRET = "ngo-connect-admin-workspace-test-secret";
  userRepository.findAuthStatusById = async (userId) => ({ user_id: userId, is_suspended: true });
  const token = jwt.sign({ userId: "40000000-0000-4000-8000-000000000001", role: "INDIVIDUAL" }, process.env.JWT_SECRET);
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(value) { this.body = value; } };
  try {
    await authenticate({ headers: { authorization: `Bearer ${token}` } }, response, () => assert.fail("suspended session must be rejected"));
    assert.equal(response.statusCode, 401);
    assert.equal(response.body.message, "Account is unavailable");
  } finally { userRepository.findAuthStatusById = originalStatus; }
});

test("suspension and moderation validators require bounded reasons and reject extra fields", async () => {
  const validUser = await runValidation(userStatus, { params: { userId: "40000000-0000-4000-8000-000000000001" }, body: { suspended: true, reason: "Abuse report reviewed" } });
  assert.equal(validUser.length, 0);
  const invalidUser = await runValidation(userStatus, { params: { userId: "bad" }, body: { suspended: true, reason: "", role: "ADMIN" } });
  assert.ok(invalidUser.length >= 3);
  const invalidNeed = await runValidation(needModeration, { params: { needId: "40000000-0000-4000-8000-000000000001" }, body: { hidden: true, reason: "  " } });
  assert.ok(invalidNeed.length);
});

test("Admin service returns 404 for missing users and needs", async () => {
  const originals = { getUser: repository.getUser, getNeed: repository.getNeed };
  const oldExpiry = needLifecycleRepository.expireDueNeeds;
  try {
    needLifecycleRepository.expireDueNeeds = async () => [];
    repository.getUser = async () => null;
    repository.getNeed = async () => null;
    await assert.rejects(service.getUser("missing"), (e) => e.statusCode === 404);
    await assert.rejects(service.getNeed("missing"), (e) => e.statusCode === 404);
  } finally { Object.assign(repository, originals); needLifecycleRepository.expireDueNeeds = oldExpiry; }
});

test("suspension protects self and the last active administrator", async () => {
  const originalConnect = pool.connect;
  const statements = [];
  const targetId = "40000000-0000-4000-8000-000000000001";
  pool.connect = async () => ({
    async query(sql) {
      const statement = sql.replace(/\s+/g, " ").trim(); statements.push(statement);
      if (statement.startsWith("SELECT user_id, role, is_suspended")) return { rows: [{ user_id: targetId, role: "ADMIN", is_suspended: false }] };
      if (statement.startsWith("SELECT COUNT(*)")) return { rows: [{ count: 1 }] };
      return { rows: [] };
    }, release() {},
  });
  try {
    await assert.rejects(repository.setUserSuspension({ userId: targetId, adminUserId: targetId, suspended: true, reason: "self" }), (e) => e.publicCode === "ADMIN_SELF_SUSPENSION_BLOCKED");
    await assert.rejects(repository.setUserSuspension({ userId: targetId, adminUserId: "40000000-0000-4000-8000-000000000002", suspended: true, reason: "last admin" }), (e) => e.publicCode === "LAST_ADMIN_PROTECTED");
    assert.ok(statements.includes("ROLLBACK"));
    assert.equal(statements.some((sql) => sql.startsWith("UPDATE users")), false);
  } finally { pool.connect = originalConnect; }
});

test("analytics are built from grouped database queries without hardcoded result rows", async () => {
  const originalQuery = pool.query;
  const sql = [];
  pool.query = async (statement) => { sql.push(statement); return { rows: statement.includes("SELECT COUNT(*)::int AS count") ? [{ count: 0 }] : [] }; };
  try {
    const result = await repository.getAnalytics();
    assert.deepEqual(result, { registrations: [], ngoVerification: [], needs: [], completionDatesUnavailable: 0, engagement: [], needCategories: [] });
    assert.equal(sql.length, 6);
    assert.ok(sql.some((query) => query.includes("volunteer_applications")));
    assert.ok(sql.some((query) => query.includes("date_trunc('month'")));
  } finally { pool.query = originalQuery; }
});

test("migration 004 grants only audit reads/inserts and rollback drops the granted table", () => {
  const migrationPath = path.resolve(__dirname, "../../database/migrations");
  const up = fs.readFileSync(path.join(migrationPath, "004_admin_workspace.sql"), "utf8");
  const down = fs.readFileSync(path.join(migrationPath, "004_admin_workspace.down.sql"), "utf8");
  assert.match(up.trimStart(), /^BEGIN;/);
  assert.match(up.trimEnd(), /COMMIT;$/);
  assert.match(up, /GRANT SELECT, INSERT\s+ON TABLE public\.admin_action_history\s+TO ngo_connect_runtime;/);
  assert.match(up, /REVOKE UPDATE, DELETE, TRUNCATE\s+ON TABLE public\.admin_action_history\s+FROM ngo_connect_runtime;/);
  assert.match(up, /REVOKE UPDATE, DELETE, TRUNCATE\s+ON TABLE public\.admin_action_history\s+FROM PUBLIC;/);
  assert.match(down, /DROP TABLE admin_action_history;/);
  assert.doesNotMatch(down, /GRANT|REVOKE/i);
});

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { validationResult } = require("express-validator");
const ngoRepository = require("../src/repositories/ngo.repository");
const workspaceRepository = require("../src/repositories/ngoWorkspace.repository");
const workspaceService = require("../src/services/ngoWorkspace.service");
const lifecycleRepository = require("../src/repositories/needLifecycle.repository");
const { listNeedsValidator, listResponsesValidator, needIdValidator } = require("../src/validators/ngoWorkspace.validator");

const userId = "10000000-0000-4000-8000-000000000001";
const ngoId = "20000000-0000-4000-8000-000000000001";
const needId = "30000000-0000-4000-8000-000000000001";

test("NGO workspace derives scope from the authenticated user's NGO profile", async () => {
  const originalNgo = ngoRepository.findNgoByUserId;
  const originalList = workspaceRepository.findOwnedNeeds;
  const originalExpiry = lifecycleRepository.expireDueNeeds;
  let received;
  ngoRepository.findNgoByUserId = async (id) => { assert.equal(id, userId); return { ngo_id: ngoId }; };
  workspaceRepository.findOwnedNeeds = async (input) => { received = input; return { total: 0, items: [] }; };
  lifecycleRepository.expireDueNeeds = async () => [];
  try {
    const data = await workspaceService.listOwnedNeeds(userId, { limit: 20, offset: 0, status: "DRAFT" });
    assert.equal(received.ngoId, ngoId);
    assert.equal(received.status, "DRAFT");
    assert.deepEqual(data.items, []);
  } finally {
    ngoRepository.findNgoByUserId = originalNgo;
    workspaceRepository.findOwnedNeeds = originalList;
    lifecycleRepository.expireDueNeeds = originalExpiry;
  }
});

test("NGO workspace returns 404 when the authenticated account has no NGO profile", async () => {
  const original = ngoRepository.findNgoByUserId;
  ngoRepository.findNgoByUserId = async () => null;
  try { await assert.rejects(workspaceService.getDashboard(userId), (error) => error.statusCode === 404); }
  finally { ngoRepository.findNgoByUserId = original; }
});

test("NGO workspace queries are parameterized, owner-scoped, expose no direct contact and preserve money history", async () => {
  const pool = require("../src/config/database");
  const original = pool.query;
  const queries = [];
  pool.query = async (sql, values) => { queries.push({ sql, values }); return { rows: [{ total: 0, items: [] }] }; };
  try {
    await workspaceRepository.findOwnedNeeds({ ngoId, limit: 20, offset: 0, status: "DRAFT", contributionType: null, search: null });
    await workspaceRepository.findResponses({ ngoId, limit: 50, offset: 0, status: null, contributionType: null, needId: null, search: null });
    await workspaceRepository.findDashboard(ngoId);
  } finally { pool.query = original; }
  assert.deepEqual(queries.map((query) => query.values[0]), [ngoId, ngoId, ngoId]);
  assert.match(queries[0].sql, /n\.ngo_id = \$1/);
  assert.match(queries[1].sql, /n\.ngo_id = \$1/);
  assert.match(queries[1].sql, /UNION ALL/);
  assert.match(queries[1].sql, /contribution_type/);
  assert.doesNotMatch(queries[1].sql, /individual_email|individual_phone|u\.email|u\.phone/i);
  assert.doesNotMatch(queries[1].sql, /contribution_type\s*<>\s*'MONEY'/i); // Historical money rows remain visible as read-only data.
});

const validate = async (validators, req) => {
  await Promise.all(validators.map((validator) => validator.run(req)));
  return validationResult(req).array();
};

test("NGO workspace validators enforce pagination, schema statuses, contribution types, and UUIDs", async () => {
  assert.equal((await validate(listNeedsValidator, { query: { limit: "100", offset: "0", status: "FULFILLED", contributionType: "MATERIAL" }, params: {}, body: {} })).length, 0);
  assert.ok((await validate(listNeedsValidator, { query: { status: "CANCELLED" }, params: {}, body: {} })).length > 0);
  assert.ok((await validate(listResponsesValidator, { query: { status: "NOPE", contributionType: "NOPE", needId: "bad" }, params: {}, body: {} })).length >= 3);
  assert.equal((await validate(needIdValidator, { query: {}, params: { needId }, body: {} })).length, 0);
});

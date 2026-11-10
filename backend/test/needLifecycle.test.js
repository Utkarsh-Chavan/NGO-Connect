const { test } = require("node:test");
const assert = require("node:assert/strict");

const needLifecycleRepository = require("../src/repositories/needLifecycle.repository");
const needRepository = require("../src/repositories/need.repository");
const ngoRepository = require("../src/repositories/ngo.repository");
const needService = require("../src/services/need.service");
const applicationRepository = require("../src/repositories/volunteerApplication.repository");
const applicationService = require("../src/services/volunteerApplication.service");
const contributionRepository = require("../src/repositories/contribution.repository");
const contributionService = require("../src/services/contribution.service");
const adminWorkspaceService = require("../src/services/adminWorkspace.service");
const ngoWorkspaceService = require("../src/services/ngoWorkspace.service");
const matchingService = require("../src/services/matching.service");
const matchingRepository = require("../src/repositories/matching.repository");
const ngoWorkspaceRepository = require("../src/repositories/ngoWorkspace.repository");
const expirationWorker = require("../src/services/needExpiration.worker");

const id = "10000000-0000-4000-8000-000000000001";

test("engagement transition matrix permits only existing forward transitions", async () => {
  const oldNgo = ngoRepository.findNgoByUserId;
  const oldApplicationContext = applicationRepository.findApplicationReviewContext;
  const oldUpdateApplication = applicationRepository.updateApplicationStatus;
  const oldContributionUpdate = contributionRepository.transitionContribution;
  ngoRepository.findNgoByUserId = async () => ({ ngo_id: id });
  applicationRepository.findApplicationReviewContext = async () => ({ status: "APPLIED", ngo_id: id, ngo_user_id: id });
  applicationRepository.updateApplicationStatus = async ({ expectedStatus, status }) => ({ expectedStatus, status });
  contributionRepository.transitionContribution = async ({ expectedStatus, status }) => ({ kind: "UPDATED", data: { expectedStatus, status } });
  try {
    assert.deepEqual(await applicationService.reviewApplication(id, id, id, "ACCEPTED"), { expectedStatus: "APPLIED", status: "ACCEPTED" });
    assert.deepEqual(await applicationService.reviewApplication(id, id, id, "REJECTED"), { expectedStatus: "APPLIED", status: "REJECTED" });
    applicationRepository.findApplicationReviewContext = async () => ({ status: "ACCEPTED", ngo_id: id, ngo_user_id: id });
    assert.deepEqual(await applicationService.reviewApplication(id, id, id, "COMPLETED"), { expectedStatus: "ACCEPTED", status: "COMPLETED" });
    await assert.rejects(applicationService.reviewApplication(id, id, id, "ACCEPTED"), { statusCode: 409 });
    assert.deepEqual(await contributionService.updateContributionStatus(id, id, id, "ACCEPTED"), { expectedStatus: "PENDING", status: "ACCEPTED" });
    assert.deepEqual(await contributionService.updateContributionStatus(id, id, id, "IN_PROGRESS"), { expectedStatus: "ACCEPTED", status: "IN_PROGRESS" });
    assert.deepEqual(await contributionService.updateContributionStatus(id, id, id, "COMPLETED"), { expectedStatus: "IN_PROGRESS", status: "COMPLETED" });
    await assert.rejects(contributionService.updateContributionStatus(id, id, id, "PENDING"), { statusCode: 400 });
  } finally {
    ngoRepository.findNgoByUserId = oldNgo;
    applicationRepository.findApplicationReviewContext = oldApplicationContext;
    applicationRepository.updateApplicationStatus = oldUpdateApplication;
    contributionRepository.transitionContribution = oldContributionUpdate;
  }
});

test("need closure is NGO-owned and completed needs are protected", async () => {
  const oldNgo = ngoRepository.findNgoByUserId;
  const oldClose = needLifecycleRepository.closeNeed;
  ngoRepository.findNgoByUserId = async () => ({ ngo_id: id });
  needLifecycleRepository.closeNeed = async () => ({ kind: "CLOSED", canceledEngagements: { applications: 2, contributions: 1 } });
  try {
    assert.equal((await needService.closeOwnedNeed(id, id)).canceledEngagements.applications, 2);
    needLifecycleRepository.closeNeed = async () => ({ kind: "COMPLETED" });
    await assert.rejects(needService.closeOwnedNeed(id, id), { statusCode: 409 });
    needLifecycleRepository.closeNeed = async () => ({ kind: "NOT_FOUND" });
    await assert.rejects(needService.closeOwnedNeed(id, id), { statusCode: 404 });
  } finally {
    ngoRepository.findNgoByUserId = oldNgo;
    needLifecycleRepository.closeNeed = oldClose;
  }
});

test("expiry treats a deadline equal to the database clock as due and preserves idempotency", async () => {
  const pool = require("../src/config/database");
  const originalConnect = pool.connect;
  const statements = [];
  const client = {
    async query(sql) { statements.push(sql.replace(/\s+/g, " ").trim()); return { rows: [] }; },
    release() {},
  };
  pool.connect = async () => client;
  try { await needLifecycleRepository.expireDueNeeds(); }
  finally { pool.connect = originalConnect; }
  const expiry = statements.find((sql) => sql.startsWith("WITH due AS"));
  assert.match(expiry, /deadline <= clock_timestamp\(\)/);
  assert.match(expiry, /FOR UPDATE SKIP LOCKED/);
  assert.match(expiry, /ON CONFLICT \(event_key\) DO NOTHING/);
  assert.match(expiry, /'need-lifecycle:expired:'/);
});

test("read-only workspace and reporting services do not invoke expiration", async () => {
  const expiryCalls = [];
  const oldExpire = needLifecycleRepository.expireDueNeeds;
  const oldHistory = needLifecycleRepository.findHistoryForNeed;
  const oldAdmin = {
    getDashboard: adminWorkspaceService.getDashboard,
    listNeeds: adminWorkspaceService.listNeeds,
    getNeed: adminWorkspaceService.getNeed,
    getAnalytics: adminWorkspaceService.getAnalytics,
  };
  const oldNeed = {
    findPublicNeeds: needRepository.findPublicNeeds,
    findPublicNeedById: needRepository.findPublicNeedById,
    findOwnedNeedById: needRepository.findOwnedNeedById,
  };
  const oldNgo = ngoRepository.findNgoByUserId;
  const oldWorkspace = {
    findOwnedNeeds: ngoWorkspaceRepository.findOwnedNeeds,
    findResponses: ngoWorkspaceRepository.findResponses,
    findDashboard: ngoWorkspaceRepository.findDashboard,
  };
  const oldMatching = matchingRepository.findEligibleNeedsForUser;
  needLifecycleRepository.expireDueNeeds = async () => { expiryCalls.push("expire"); throw new Error("unexpected expiry"); };
  needLifecycleRepository.findHistoryForNeed = async () => [];
  adminWorkspaceService.getDashboard = async () => ({});
  adminWorkspaceService.listNeeds = async () => ({});
  adminWorkspaceService.getNeed = async () => ({});
  adminWorkspaceService.getAnalytics = async () => ({});
  needRepository.findPublicNeeds = async () => [];
  needRepository.findPublicNeedById = async () => ({ need_id: id });
  needRepository.findOwnedNeedById = async () => ({ need_id: id });
  ngoRepository.findNgoByUserId = async () => ({ ngo_id: id });
  ngoWorkspaceRepository.findOwnedNeeds = async () => ({ items: [], total: 0 });
  ngoWorkspaceRepository.findResponses = async () => ({ items: [], total: 0 });
  ngoWorkspaceRepository.findDashboard = async () => ({});
  matchingRepository.findEligibleNeedsForUser = async () => [];
  try {
    await adminWorkspaceService.getDashboard();
    await adminWorkspaceService.listNeeds({});
    await adminWorkspaceService.getNeed(id);
    await adminWorkspaceService.getAnalytics();
    await needService.listNeeds({});
    await needService.getNeed(id);
    await needService.getOwnedNeed(id, id);
    await ngoWorkspaceService.listOwnedNeeds(id, { limit: 20, offset: 0 });
    await ngoWorkspaceService.listResponses(id, { limit: 20, offset: 0 });
    await ngoWorkspaceService.getDashboard(id);
    await matchingService.getRecommendations(id);
    assert.deepEqual(expiryCalls, []);
  } finally {
    needLifecycleRepository.expireDueNeeds = oldExpire;
    needLifecycleRepository.findHistoryForNeed = oldHistory;
    Object.assign(adminWorkspaceService, oldAdmin);
    Object.assign(needRepository, oldNeed);
    ngoRepository.findNgoByUserId = oldNgo;
    Object.assign(ngoWorkspaceRepository, oldWorkspace);
    matchingRepository.findEligibleNeedsForUser = oldMatching;
  }
});

test("expiration worker coalesces overlapping sweeps in one application instance", async () => {
  const originalExpire = needLifecycleRepository.expireDueNeeds;
  let calls = 0;
  let release;
  needLifecycleRepository.expireDueNeeds = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    const first = expirationWorker.runExpirationSweep();
    const second = expirationWorker.runExpirationSweep();
    assert.equal(calls, 1);
    release([]);
    await Promise.all([first, second]);
  } finally {
    needLifecycleRepository.expireDueNeeds = originalExpire;
  }
});

test("expiration worker starts with an immediate sweep and stops without scheduling another", async () => {
  const originalExpire = needLifecycleRepository.expireDueNeeds;
  let calls = 0;
  let release;
  needLifecycleRepository.expireDueNeeds = () => {
    calls += 1;
    return new Promise((resolve) => { release = resolve; });
  };
  try {
    expirationWorker.start();
    assert.equal(calls, 1);
    const stopping = expirationWorker.stop();
    release([]);
    await stopping;
    assert.equal(calls, 1);
  } finally {
    await expirationWorker.stop();
    needLifecycleRepository.expireDueNeeds = originalExpire;
  }
});

test("migration 006 is transactional and rollback guards lifecycle data before dropping it", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const up = fs.readFileSync(path.resolve(__dirname, "../../database/migrations/006_need_engagement_lifecycle.sql"), "utf8");
  const down = fs.readFileSync(path.resolve(__dirname, "../../database/migrations/006_need_engagement_lifecycle.down.sql"), "utf8");
  assert.match(up.trimStart(), /^BEGIN;/);
  assert.match(up.trimEnd(), /COMMIT;$/);
  assert.match(up, /CREATE TABLE public\.need_lifecycle_history/);
  assert.match(up, /GRANT SELECT, INSERT ON TABLE public\.need_lifecycle_history TO ngo_connect_runtime/);
  assert.match(down.trimStart(), /^BEGIN;/);
  assert.ok(down.indexOf("IF EXISTS (SELECT 1 FROM public.needs") < down.indexOf("DROP TABLE public.need_lifecycle_history"));
  assert.match(down, /Cannot roll back lifecycle states/);
  assert.match(down, /Cannot roll back while need lifecycle notifications exist/);
  assert.match(down, /Cannot roll back while lifecycle history exists/);
  assert.match(down, /Cannot roll back while engagement resolution reasons exist/);
});

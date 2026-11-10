require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env"), quiet: true });

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
if (!testDatabaseUrl) {
  throw new Error("Set TEST_DATABASE_URL to a dedicated ngo_connect_test PostgreSQL database.");
}

const parsedTestUrl = new URL(testDatabaseUrl);
const databaseName = decodeURIComponent(parsedTestUrl.pathname.slice(1));
if (databaseName !== "ngo_connect_test") {
  throw new Error("Refusing integration tests: TEST_DATABASE_URL database name must be exactly ngo_connect_test.");
}

if (process.env.DB_NAME === databaseName) {
  throw new Error("Refusing integration tests: TEST_DATABASE_URL points to the configured application database.");
}

process.env.DB_HOST = decodeURIComponent(parsedTestUrl.hostname);
process.env.DB_PORT = parsedTestUrl.port || "5432";
process.env.DB_NAME = databaseName;
process.env.DB_USER = decodeURIComponent(parsedTestUrl.username);
process.env.DB_PASSWORD = decodeURIComponent(parsedTestUrl.password);
process.env.JWT_SECRET = crypto.randomBytes(32).toString("hex");
process.env.JWT_EXPIRES_IN = "5m";
const needExpirationWorker = require("../../src/services/needExpiration.worker");
const needLifecycleRepository = require("../../src/repositories/needLifecycle.repository");

const testPool = new Pool({ connectionString: testDatabaseUrl });
const runId = crypto.randomUUID();
const createdUserIds = [];
const createdVerificationSubmissionIds = [];
let createdCauseId;
let appPool;
let server;
let baseUrl;
let approvedUserId;
let pendingUserId;
let otherUserId;
let approvedNgoId;
let pendingNgoId;
let causeId;
let activeNeedId;
let draftNeedId;
let pastDeadlineNeedId;
const jwtSecret = process.env.JWT_SECRET;

const tokenFor = (userId, role = "NGO") => jwt.sign({ userId, role }, jwtSecret);

const request = (path, { method = "GET", token, body } = {}) => fetch(`${baseUrl}${path}`, {
  method,
  headers: {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  },
  ...(body ? { body: JSON.stringify(body) } : {}),
});

const needInput = (overrides = {}) => ({
  causeId,
  title: `Integration need ${runId.slice(0, 8)}`,
  description: "Need API integration fixture.",
  contributionType: "MATERIAL",
  location: null,
  availability: null,
  quantityRequired: 10,
  priority: "MEDIUM",
  deadline: "2099-10-20T12:00:00Z",
  status: "ACTIVE",
  ...overrides,
});

const createUserWithNgo = async (email, status) => {
  const client = await testPool.connect();
  try {
    await client.query("BEGIN");
    const userResult = await client.query(
      `INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, 'NGO') RETURNING user_id`,
      [`Integration ${email}`, email, "integration-test-hash"]
    );
    const userId = userResult.rows[0].user_id;
    createdUserIds.push(userId);
    const ngoResult = await client.query(
      `INSERT INTO ngos (user_id, name, email, city, verification_status) VALUES ($1, $2, $3, $4, $5) RETURNING ngo_id`,
      [userId, `Integration NGO ${email}`, email, "Test City", status]
    );
    const ngoId = ngoResult.rows[0].ngo_id;

    // Model a schema-backed legacy import. The migration permits a NULL
    // submitted_at only for legacy_import rows and requires one current row
    // matching the NGO status at transaction commit.
    const submissionResult = await client.query(
      `INSERT INTO ngo_verification_submissions (
         ngo_id, ngo_id_snapshot, submission_number, status, is_current,
         legacy_import, submitted_by_user_id, submitted_at
       ) VALUES ($1, $1, 1, $2, TRUE, TRUE, NULL, NULL)
       RETURNING submission_id`,
      [ngoId, status]
    );
    const submissionId = submissionResult.rows[0].submission_id;
    createdVerificationSubmissionIds.push(submissionId);
    await client.query(
      `INSERT INTO ngo_verification_history (
         ngo_id_snapshot, ngo_name_snapshot, verification_status_snapshot,
         submission_id_snapshot, actor_user_id_snapshot, actor_name_snapshot,
         action, message
       ) VALUES ($1, $2, $3, $4, NULL, NULL, 'LEGACY_IMPORTED', $5)`,
      [ngoId, `Integration NGO ${email}`, status, submissionId, "Integration legacy fixture."]
    );
    await client.query("COMMIT");
    return { userId, ngoId };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

before(async () => {
  const schemaResult = await testPool.query(`
    SELECT current_database() AS current_database,
           to_regclass('public.users') AS users_table,
           to_regclass('public.ngos') AS ngos_table,
           to_regclass('public.causes') AS causes_table,
           to_regclass('public.needs') AS needs_table
  `);
  const schema = schemaResult.rows[0];
  if (schema.current_database !== "ngo_connect_test"
      || !schema.users_table || !schema.ngos_table || !schema.causes_table || !schema.needs_table) {
    throw new Error("Integration database is not initialized with the expected public NGO Connect schema.");
  }

  const approved = await createUserWithNgo(`${runId}.approved@example.test`, "APPROVED");
  const pending = await createUserWithNgo(`${runId}.pending@example.test`, "PENDING");
  const other = await createUserWithNgo(`${runId}.other@example.test`, "APPROVED");
  approvedUserId = approved.userId;
  approvedNgoId = approved.ngoId;
  pendingUserId = pending.userId;
  pendingNgoId = pending.ngoId;
  otherUserId = other.userId;

  const causeResult = await testPool.query(
    `INSERT INTO causes (name, description) VALUES ($1, $2) RETURNING cause_id`,
    [`Integration cause ${runId}`, "Created only for the integration test run."]
  );
  causeId = causeResult.rows[0].cause_id;
  createdCauseId = causeId;

  const app = require("../../src/app");
  appPool = require("../../src/config/database");
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  if (createdUserIds.length) {
    await testPool.query(`DELETE FROM users WHERE user_id = ANY($1::uuid[])`, [createdUserIds]);
  }
  if (createdVerificationSubmissionIds.length) {
    await testPool.query(
      "DELETE FROM ngo_verification_submissions WHERE submission_id = ANY($1::uuid[])",
      [createdVerificationSubmissionIds]
    );
  }
  if (createdCauseId) {
    await testPool.query(`DELETE FROM causes WHERE cause_id = $1`, [createdCauseId]);
  }
  if (appPool) await appPool.end();
  await testPool.end();
});

test("schema-backed Need API enforces publishing, visibility, ownership, validation, and auth", async (t) => {
  const activeResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId), body: needInput({
      title: `Pune library books ${runId.slice(0, 6)}`,
      description: "Books needed for a neighborhood reading room.", location: "Pune",
    }),
  });
  assert.equal(activeResponse.status, 201);
  activeNeedId = (await activeResponse.json()).data.need_id;

  const deniedResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(pendingUserId), body: needInput(),
  });
  assert.equal(deniedResponse.status, 403);

  const draftResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(pendingUserId), body: needInput({ status: "DRAFT" }),
  });
  assert.equal(draftResponse.status, 201);
  draftNeedId = (await draftResponse.json()).data.need_id;

  const pastResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId),
    body: needInput({ deadline: new Date(Date.now() + 60000).toISOString() }),
  });
  assert.equal(pastResponse.status, 201);
  pastDeadlineNeedId = (await pastResponse.json()).data.need_id;
  await testPool.query("UPDATE needs SET deadline = clock_timestamp() - INTERVAL '1 second' WHERE need_id = $1", [pastDeadlineNeedId]);

  const listResponse = await request("/api/needs?limit=100");
  assert.equal(listResponse.status, 200);
  const listedIds = (await listResponse.json()).data.items.map((need) => need.need_id);
  const unchangedState = await testPool.query("SELECT status, expired_at FROM needs WHERE need_id = $1", [pastDeadlineNeedId]);
  assert.equal(unchangedState.rows[0].status, "ACTIVE");
  assert.equal(unchangedState.rows[0].expired_at, null);
  assert.ok(!listedIds.includes(pastDeadlineNeedId));

  await Promise.all([needExpirationWorker.runExpirationSweep(), needLifecycleRepository.expireDueNeeds()]);
  const expiredState = await testPool.query("SELECT status, expired_at FROM needs WHERE need_id = $1", [pastDeadlineNeedId]);
  assert.equal(expiredState.rows[0].status, "EXPIRED");
  assert.ok(expiredState.rows[0].expired_at);
  assert.ok(listedIds.includes(activeNeedId));
  assert.ok(!listedIds.includes(draftNeedId));
  assert.ok(!listedIds.includes(pastDeadlineNeedId));
  const expiryHistory = await testPool.query("SELECT COUNT(*)::int AS count FROM need_lifecycle_history WHERE need_id = $1 AND event_type = 'EXPIRED'", [pastDeadlineNeedId]);
  const expiryNotifications = await testPool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE event_type = 'NEED_EXPIRED' AND related_entity_id = $1", [pastDeadlineNeedId]);
  assert.equal(expiryHistory.rows[0].count, 1);
  assert.equal(expiryNotifications.rows[0].count, 1);
  await needLifecycleRepository.expireDueNeeds();
  const repeatedHistory = await testPool.query("SELECT COUNT(*)::int AS count FROM need_lifecycle_history WHERE need_id = $1 AND event_type = 'EXPIRED'", [pastDeadlineNeedId]);
  const repeatedNotifications = await testPool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE event_type = 'NEED_EXPIRED' AND related_entity_id = $1", [pastDeadlineNeedId]);
  assert.equal(repeatedHistory.rows[0].count, 1);
  assert.equal(repeatedNotifications.rows[0].count, 1);

  assert.equal((await request(`/api/needs/${activeNeedId}`)).status, 200);
  assert.equal((await request(`/api/needs/${draftNeedId}`)).status, 404);
  assert.equal((await request("/api/needs/not-a-uuid")).status, 400);
  assert.equal((await request("/api/needs/30000000-0000-4000-8000-000000000099")).status, 404);

  const badEnum = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId), body: needInput({ priority: "ASAP" }),
  });
  assert.equal(badEnum.status, 400);

  const unauthorized = await request("/api/needs", { method: "POST", body: needInput() });
  assert.equal(unauthorized.status, 401);
  const wrongRole = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId, "INDIVIDUAL"), body: needInput(),
  });
  assert.equal(wrongRole.status, 403);

  const updatedNeedTitle = `Updated integration need Pune library ${runId.slice(0, 6)}`;
  const updateBody = needInput({
    title: updatedNeedTitle,
    description: "Books needed for a neighborhood reading room.",
    location: "Pune",
  });
  const otherUpdate = await request(`/api/needs/${activeNeedId}`, {
    method: "PUT", token: tokenFor(otherUserId), body: updateBody,
  });
  assert.equal(otherUpdate.status, 404);

  const rollback = await request(`/api/needs/${activeNeedId}`, {
    method: "PUT", token: tokenFor(approvedUserId), body: needInput({ status: "DRAFT" }),
  });
  assert.equal(rollback.status, 404);

  await testPool.query(`UPDATE needs SET quantity_fulfilled = 8 WHERE need_id = $1`, [activeNeedId]);
  const quantityConflict = await request(`/api/needs/${activeNeedId}`, {
    method: "PUT", token: tokenFor(approvedUserId),
    body: needInput({ quantityRequired: 5, status: "ACTIVE" }),
  });
  assert.equal(quantityConflict.status, 409);
  assert.match((await quantityConflict.json()).message, /fulfilled quantity plus accepted reservations/);
  await testPool.query(`UPDATE needs SET quantity_fulfilled = 0 WHERE need_id = $1`, [activeNeedId]);

  const ownerUpdate = await request(`/api/needs/${activeNeedId}`, {
    method: "PUT", token: tokenFor(approvedUserId), body: updateBody,
  });
  assert.equal(ownerUpdate.status, 200);
  assert.equal((await ownerUpdate.json()).data.title, updatedNeedTitle);

  const secondPublicResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId), body: needInput({
      title: `Volunteer tutoring ${runId.slice(0, 6)}`, description: "Tutor children after school.",
      contributionType: "VOLUNTEER", location: "Test City",
    }),
  });
  assert.equal(secondPublicResponse.status, 201);
  const secondPublicId = (await secondPublicResponse.json()).data.need_id;

  const hiddenResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(approvedUserId), body: needInput({ title: `Hidden ${runId.slice(0, 6)}` }),
  });
  const hiddenNeedId = (await hiddenResponse.json()).data.need_id;
  await testPool.query("UPDATE needs SET moderation_status = 'HIDDEN', moderated_at = NOW(), moderation_reason = 'Integration fixture' WHERE need_id = $1", [hiddenNeedId]);

  const suspendedNeedResponse = await request("/api/needs", {
    method: "POST", token: tokenFor(otherUserId), body: needInput({ title: `Suspended owner ${runId.slice(0, 6)}` }),
  });
  assert.equal(suspendedNeedResponse.status, 201);
  const suspendedNeedId = (await suspendedNeedResponse.json()).data.need_id;
  await testPool.query("UPDATE users SET is_suspended = TRUE, suspended_at = NOW(), suspension_reason = 'Integration fixture' WHERE user_id = $1", [otherUserId]);

  const unapprovedNeed = await testPool.query(`
    INSERT INTO needs (ngo_id, cause_id, title, description, contribution_type, status)
    VALUES ($1, $2, $3, 'Must remain private', 'MATERIAL', 'ACTIVE') RETURNING need_id
  `, [pendingNgoId, causeId, `Unapproved ${runId.slice(0, 6)}`]);
  const unapprovedNeedId = unapprovedNeed.rows[0].need_id;

  const titleSearch = await request(`/api/needs?search=${encodeURIComponent(`pune library ${runId.slice(0, 6)}`)}`);
  assert.equal(titleSearch.status, 200);
  let listing = (await titleSearch.json()).data;
  assert.equal(listing.items.length, 1);
  assert.equal(listing.items[0].need_id, activeNeedId);
  assert.equal(listing.pagination.total, 1);

  const descriptionSearch = await request(`/api/needs?search=${encodeURIComponent("neighborhood reading room")}`);
  listing = (await descriptionSearch.json()).data;
  assert.ok(listing.items.some((need) => need.need_id === activeNeedId));

  const filtered = await request(`/api/needs?causeId=${causeId}&contributionType=material&location=pUnE&search=${encodeURIComponent("library")}&limit=1`);
  assert.equal(filtered.status, 200);
  listing = (await filtered.json()).data;
  assert.equal(listing.items.length, 1);
  assert.equal(listing.items[0].need_id, activeNeedId);
  assert.deepEqual(listing.pagination, { limit: 1, offset: 0, total: 1, hasPrevious: false, hasNext: false });

  const typeAndLocation = await request(`/api/needs?contributionType=VOLUNTEER&location=city&causeId=${causeId}`);
  listing = (await typeAndLocation.json()).data;
  assert.deepEqual(listing.items.map((need) => need.need_id), [secondPublicId]);

  const guestList = await request(`/api/needs?causeId=${causeId}&limit=1&offset=0`);
  assert.equal(guestList.status, 200);
  const guestPage = (await guestList.json()).data;
  assert.equal(guestPage.pagination.total, 2);
  assert.equal(guestPage.pagination.hasNext, true);
  const secondPage = await request(`/api/needs?causeId=${causeId}&limit=1&offset=1`);
  assert.equal((await secondPage.json()).data.pagination.hasPrevious, true);

  const allPublic = await request("/api/needs?limit=100");
  const publicIds = (await allPublic.json()).data.items.map((need) => need.need_id);
  assert.ok(publicIds.includes(activeNeedId));
  assert.ok(publicIds.includes(secondPublicId));
  for (const excludedId of [draftNeedId, pastDeadlineNeedId, hiddenNeedId, suspendedNeedId, unapprovedNeedId]) {
    assert.ok(!publicIds.includes(excludedId), `ineligible need ${excludedId} must not be returned`);
  }
  for (const excludedId of [draftNeedId, pastDeadlineNeedId, hiddenNeedId, suspendedNeedId, unapprovedNeedId]) {
    assert.equal((await request(`/api/needs/${excludedId}`)).status, 404);
  }

  const invalidFilter = await request("/api/needs?contributionType=FOOD");
  assert.equal(invalidFilter.status, 400);
  const invalidCause = await request("/api/needs?causeId=not-a-uuid");
  assert.equal(invalidCause.status, 400);

  await t.test("test records remain scoped to this integration run", async () => {
    const result = await testPool.query(
      `SELECT count(*)::int AS count FROM needs WHERE ngo_id = $1`, [approvedNgoId]
    );
    assert.equal(result.rows[0].count, 4);
  });
});

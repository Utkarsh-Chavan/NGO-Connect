require("dotenv").config({ path: require("node:path").resolve(__dirname, "../../.env"), quiet: true });
process.env.NODE_ENV = "test";

const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");
const { Readable } = require("node:stream");
const emailDeliveryService = require("../../src/services/emailDelivery.service");
const privateDocumentStorage = require("../../src/services/privateDocumentStorage.service");

// This suite intentionally accepts no application DATABASE_URL fallback.
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
process.env.EMAIL_VERIFICATION_URL = "https://frontend.example.test/verify-email";
const needExpirationWorker = require("../../src/services/needExpiration.worker");
const needLifecycleRepository = require("../../src/repositories/needLifecycle.repository");

const testPool = new Pool({ connectionString: testDatabaseUrl });
const runId = crypto.randomUUID();
const emailFor = (label) => `integration.${runId.replaceAll("-", "").slice(0, 16)}.${label}@example.test`;
const password = `Test-${crypto.randomUUID()}-Password!`;
const createdUserIds = [];
const createdCauseIds = [];
const createdSkillIds = [];
const createdNeedIds = [];
const createdApplicationIds = [];
const createdContributionIds = [];
const createdVerificationSubmissionIds = [];
const createdVerificationDocumentIds = [];
const sentVerificationEmails = new Map();
let appPool;
let server;
let baseUrl;
let adminUserId;
let adminToken;
let causeId;
let alternateCauseId;
let skillId;
let owner;
let otherNgo;
let individual;
let applicant;
let contributor;
let matcher;
let approvedNgo;
let otherNgoProfile;
let raceNgoProfile;
let reviewRaceNgo;
let volunteerNeed;
let materialNeed;
let moneyNeed;

emailDeliveryService.setEmailDeliveryAdapter({
  async sendVerificationEmail({ recipient, verificationUrl }) {
    sentVerificationEmails.set(recipient, verificationUrl);
  },
});

const storedTestDocuments = new Map();
privateDocumentStorage.setStorageAdapter({
  provider: "INTEGRATION_TEST_PRIVATE",
  async put(key, buffer) { storedTestDocuments.set(key, Buffer.from(buffer)); },
  async open(key) {
    const buffer = storedTestDocuments.get(key);
    if (!buffer) {
      const error = new Error("Not found");
      error.code = "ENOENT";
      throw error;
    }
    return { stream: Readable.from(buffer), size: buffer.length };
  },
  async delete(key) { storedTestDocuments.delete(key); },
});

const tokenFor = (userId, role) => jwt.sign({ userId, role }, process.env.JWT_SECRET, { expiresIn: "5m" });

const request = (path, { method = "GET", token, body } = {}) => {
  const multipart = typeof FormData !== "undefined" && body instanceof FormData;
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined && !multipart ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}),
  });
};

const registerAccount = async (label, role = "INDIVIDUAL", city = "Pune") => {
  const email = emailFor(label);
  const response = await request("/api/auth/register", {
    method: "POST",
    body: { name: `Integration ${label}`, email, password, role, city },
  });
  const payload = await response.json();
  if (response.status !== 201) {
    // Capture a possibly committed registration before failing, so cleanup stays scoped.
    const existing = await testPool.query("SELECT user_id FROM users WHERE email = $1", [email]);
    if (existing.rows[0]) createdUserIds.push(existing.rows[0].user_id);
  } else {
    createdUserIds.push(payload.data.user_id);
  }
  assert.equal(response.status, 201, JSON.stringify(payload));
  await verifyAccount(email);
  return { userId: payload.data.user_id, email, password, token: null };
};

const loginAccount = async (account) => {
  const response = await request("/api/auth/login", {
    method: "POST",
    body: { email: account.email, password: account.password },
  });
  const payload = await response.json();
  assert.equal(response.status, 200, JSON.stringify(payload));
  return { ...account, token: payload.data.token };
};

const verifyAccount = async (email) => {
  const verificationUrl = sentVerificationEmails.get(email);
  assert.ok(verificationUrl, "test email adapter should capture the verification URL");
  const token = new URLSearchParams(new URL(verificationUrl).hash.slice(1)).get("token");
  const response = await request("/api/auth/verify-email", {
    method: "POST",
    body: { token },
  });
  assert.equal(response.status, 200);
  sentVerificationEmails.delete(email);
  return token;
};

const ngoInput = (name) => ({
  name,
  description: `${name} integration fixture`,
  email: `${name.toLowerCase().replace(/[^a-z0-9]+/g, ".")}@example.test`,
  phone: "555-0100",
  address: "1 Test Street",
  city: "Pune",
  websiteUrl: "https://example.test/ngo",
});

const makeVerificationForm = ({ certificate = true, optional = false } = {}) => {
  const form = new FormData();
  if (certificate) {
    form.append("registrationCertificate", new Blob([Buffer.from("%PDF-1.4\nregistration test")], { type: "application/pdf" }), "registration-certificate.pdf");
  }
  if (optional) {
    form.append("pan", new Blob([Buffer.from([0xff, 0xd8, 0xff, 0x00])], { type: "image/jpeg" }), "pan.jpg");
    form.append("ngoDarpan", new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])], { type: "image/png" }), "darpan.png");
    form.append("supportingDocuments", new Blob([Buffer.from("%PDF-1.4\nsupporting test")], { type: "application/pdf" }), "support.pdf");
  }
  return form;
};

const rememberSubmission = (payload) => {
  createdVerificationSubmissionIds.push(payload.data.currentSubmission.submission_id);
  for (const document of payload.data.currentSubmission.documents) {
    createdVerificationDocumentIds.push(document.document_id);
  }
};

const createNeed = async (account, { title, cause = causeId, type, priority = "MEDIUM", quantity = null, deadline = null }) => {
  const response = await request("/api/needs", {
    method: "POST",
    token: account.token,
    body: {
      causeId: cause,
      title: `${runId.slice(0, 8)} ${title}`,
      description: `Integration fixture for ${title}`,
      contributionType: type,
      location: null,
      availability: null,
      quantityRequired: quantity,
      priority,
      deadline,
      status: "ACTIVE",
    },
  });
  const payload = await response.json();
  assert.equal(response.status, 201, JSON.stringify(payload));
  createdNeedIds.push(payload.data.need_id);
  return payload.data;
};

before(async () => {
  const expectedTables = [
    "users", "ngos", "causes", "user_causes", "skills", "user_skills",
    "needs", "need_skills", "contributions", "volunteer_applications",
    "email_verification_tokens", "ngo_verification_submissions",
    "ngo_verification_documents", "ngo_verification_history", "admin_action_history", "notifications", "need_lifecycle_history",
  ];
  const schemaResult = await testPool.query(
    `SELECT current_database() AS current_database,
            array_agg(table_name ORDER BY table_name) AS tables
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`
  );
  const schema = schemaResult.rows[0];
  if (schema.current_database !== "ngo_connect_test"
      || expectedTables.some((tableName) => !schema.tables.includes(tableName))) {
    throw new Error("Integration database must be ngo_connect_test with the complete public NGO Connect schema.");
  }
  const migrationObjects = await testPool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ngos' AND column_name = 'website_url'
     ) AS has_website_url,
     to_regclass('public.uq_contributions_one_non_rejected_per_user_need') IS NOT NULL AS has_duplicate_contribution_index,
     EXISTS (
       SELECT 1 FROM pg_constraint
        WHERE conrelid = 'public.ngos'::regclass AND conname = 'chk_ngos_website_url_protocol'
     ) AS has_website_url_check,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'is_suspended') AS has_user_suspension,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'needs' AND column_name = 'moderation_status') AS has_need_moderation,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'needs' AND column_name = 'completed_at') AS has_need_completion_time,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'contributions' AND column_name = 'resolution_reason') AS has_resolution_reason,
     EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'needs' AND column_name = 'deadline' AND data_type = 'timestamp with time zone') AS has_zoned_deadline,
     to_regclass('public.idx_needs_expirable_deadline') IS NOT NULL AS has_expiry_index,
     to_regclass('public.idx_notifications_recipient_created') IS NOT NULL AS has_notification_index`
  );
  const migrationState = migrationObjects.rows[0];
  if (!migrationState.has_website_url || !migrationState.has_duplicate_contribution_index
      || !migrationState.has_website_url_check || !migrationState.has_user_suspension || !migrationState.has_need_moderation
      || !migrationState.has_notification_index || !migrationState.has_need_completion_time
      || !migrationState.has_resolution_reason || !migrationState.has_zoned_deadline || !migrationState.has_expiry_index) {
    throw new Error("Integration database requires migrations 002–006, including need lifecycle management.");
  }

  const adminResult = await testPool.query(
    `INSERT INTO users (name, email, password_hash, role, city)
     VALUES ($1, $2, $3, 'ADMIN', $4) RETURNING user_id`,
    [`Integration admin ${runId}`, emailFor("admin"), "integration-only-not-a-login-hash", "Pune"]
  );
  adminUserId = adminResult.rows[0].user_id;
  createdUserIds.push(adminUserId);
  adminToken = tokenFor(adminUserId, "ADMIN");

  const causeResult = await testPool.query(
    `INSERT INTO causes (name, description) VALUES ($1, $2), ($3, $4) RETURNING cause_id, name`,
    [`Integration cause ${runId}`, "Generated integration cause", `Integration alternate ${runId}`, "Alternate generated cause"]
  );
  for (const row of causeResult.rows) createdCauseIds.push(row.cause_id);
  causeId = causeResult.rows.find((row) => row.name.startsWith("Integration cause ")).cause_id;
  alternateCauseId = causeResult.rows.find((row) => row.name.startsWith("Integration alternate ")).cause_id;

  const skillResult = await testPool.query(
    `INSERT INTO skills (name, description) VALUES ($1, $2) RETURNING skill_id`,
    [`Integration skill ${runId}`, "Generated integration skill"]
  );
  skillId = skillResult.rows[0].skill_id;
  createdSkillIds.push(skillId);

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
  try {
    if (server) await new Promise((resolve) => server.close(resolve));
    emailDeliveryService.setEmailDeliveryAdapter(null);
    privateDocumentStorage.setStorageAdapter(null);
    storedTestDocuments.clear();
    if (createdUserIds.length || createdNeedIds.length) {
      await testPool.query(`DELETE FROM admin_action_history WHERE
        (target_type = 'USER' AND target_id = ANY($1::uuid[])) OR
        (target_type = 'NEED' AND target_id = ANY($2::uuid[]))`, [createdUserIds, createdNeedIds]);
    }
    if (createdUserIds.length) {
      await testPool.query("DELETE FROM users WHERE user_id = ANY($1::uuid[])", [createdUserIds]);
      const remainingUsers = await testPool.query("SELECT user_id FROM users WHERE user_id = ANY($1::uuid[])", [createdUserIds]);
      assert.equal(remainingUsers.rowCount, 0, "integration user fixtures should be removed");
      const remainingPreferences = await testPool.query(
        `SELECT user_id FROM user_causes WHERE user_id = ANY($1::uuid[])
         UNION ALL SELECT user_id FROM user_skills WHERE user_id = ANY($1::uuid[])`,
        [createdUserIds]
      );
      assert.equal(remainingPreferences.rowCount, 0, "integration preference fixtures should be removed");
      const remainingNgos = await testPool.query("SELECT ngo_id FROM ngos WHERE user_id = ANY($1::uuid[])", [createdUserIds]);
      assert.equal(remainingNgos.rowCount, 0, "integration NGO fixtures should be removed");
    }
    if (createdVerificationDocumentIds.length) {
      await testPool.query(
        "DELETE FROM ngo_verification_documents WHERE document_id = ANY($1::uuid[])",
        [createdVerificationDocumentIds]
      );
      const remainingDocuments = await testPool.query(
        "SELECT document_id FROM ngo_verification_documents WHERE document_id = ANY($1::uuid[])",
        [createdVerificationDocumentIds]
      );
      assert.equal(remainingDocuments.rowCount, 0, "integration document metadata fixtures should be removed");
    }
    if (createdVerificationSubmissionIds.length) {
      await testPool.query(
        "DELETE FROM ngo_verification_submissions WHERE submission_id = ANY($1::uuid[])",
        [createdVerificationSubmissionIds]
      );
      const remainingSubmissions = await testPool.query(
        "SELECT submission_id FROM ngo_verification_submissions WHERE submission_id = ANY($1::uuid[])",
        [createdVerificationSubmissionIds]
      );
      assert.equal(remainingSubmissions.rowCount, 0, "integration submission fixtures should be removed");
    }
    if (createdNeedIds.length) {
      const remainingNeeds = await testPool.query("SELECT need_id FROM needs WHERE need_id = ANY($1::uuid[])", [createdNeedIds]);
      assert.equal(remainingNeeds.rowCount, 0, "integration need fixtures should be removed by cascades");
    }
    if (createdApplicationIds.length) {
      const remainingApplications = await testPool.query(
        "SELECT application_id FROM volunteer_applications WHERE application_id = ANY($1::uuid[])",
        [createdApplicationIds]
      );
      assert.equal(remainingApplications.rowCount, 0, "integration application fixtures should be removed");
    }
    if (createdContributionIds.length) {
      const remainingContributions = await testPool.query(
        "SELECT contribution_id FROM contributions WHERE contribution_id = ANY($1::uuid[])",
        [createdContributionIds]
      );
      assert.equal(remainingContributions.rowCount, 0, "integration contribution fixtures should be removed");
    }
    if (createdCauseIds.length) {
      await testPool.query("DELETE FROM causes WHERE cause_id = ANY($1::uuid[])", [createdCauseIds]);
      const remainingCauses = await testPool.query("SELECT cause_id FROM causes WHERE cause_id = ANY($1::uuid[])", [createdCauseIds]);
      assert.equal(remainingCauses.rowCount, 0, "integration cause fixtures should be removed");
    }
    if (createdSkillIds.length) {
      await testPool.query("DELETE FROM skills WHERE skill_id = ANY($1::uuid[])", [createdSkillIds]);
      const remainingSkills = await testPool.query("SELECT skill_id FROM skills WHERE skill_id = ANY($1::uuid[])", [createdSkillIds]);
      assert.equal(remainingSkills.rowCount, 0, "integration skill fixtures should be removed");
    }
  } finally {
    if (appPool) await appPool.end();
    await testPool.end();
  }
});

test("schema-backed authentication, profiles, preferences, review workflows, and matching", async (t) => {
  await t.test("Admin audit privileges are limited to runtime SELECT and INSERT", async () => {
    const privileges = await testPool.query(`
      SELECT
        has_table_privilege('ngo_connect_runtime', 'public.admin_action_history', 'SELECT') AS runtime_select,
        has_table_privilege('ngo_connect_runtime', 'public.admin_action_history', 'INSERT') AS runtime_insert,
        has_table_privilege('ngo_connect_runtime', 'public.admin_action_history', 'UPDATE') AS runtime_update,
        has_table_privilege('ngo_connect_runtime', 'public.admin_action_history', 'DELETE') AS runtime_delete,
        has_table_privilege('ngo_connect_runtime', 'public.admin_action_history', 'TRUNCATE') AS runtime_truncate,
        COALESCE((
          SELECT array_agg(privilege_type ORDER BY privilege_type)
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
           WHERE c.oid = 'public.admin_action_history'::regclass
             AND acl.grantee = 0
        ), ARRAY[]::text[]) AS public_privileges
    `);
    assert.deepEqual(privileges.rows[0], {
      runtime_select: true,
      runtime_insert: true,
      runtime_update: false,
      runtime_delete: false,
      runtime_truncate: false,
      public_privileges: [],
    });
    const notificationPrivileges = await testPool.query(`
      SELECT
        has_table_privilege('ngo_connect_runtime', 'public.notifications', 'SELECT') AS runtime_select,
        has_table_privilege('ngo_connect_runtime', 'public.notifications', 'INSERT') AS runtime_insert,
        has_table_privilege('ngo_connect_runtime', 'public.notifications', 'UPDATE') AS runtime_table_update,
        has_column_privilege('ngo_connect_runtime', 'public.notifications', 'read_at', 'UPDATE') AS runtime_read_at_update,
        has_table_privilege('ngo_connect_runtime', 'public.notifications', 'DELETE') AS runtime_delete,
        has_table_privilege('ngo_connect_runtime', 'public.notifications', 'TRUNCATE') AS runtime_truncate,
        COALESCE((
          SELECT array_agg(privilege_type ORDER BY privilege_type)
            FROM pg_class c
            CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
           WHERE c.oid = 'public.notifications'::regclass AND acl.grantee = 0
        ), ARRAY[]::text[]) AS public_privileges
    `);
    assert.deepEqual(notificationPrivileges.rows[0], {
      runtime_select: true,
      runtime_insert: true,
      runtime_table_update: false,
      runtime_read_at_update: true,
      runtime_delete: false,
      runtime_truncate: false,
      public_privileges: [],
    });
  });

  await t.test("authentication registers unverified, verifies once, and protects login", async () => {
    const email = emailFor("auth");
    const body = { name: "Integration Authentication", email, password, role: "INDIVIDUAL", city: "Pune" };
    const registered = await request("/api/auth/register", { method: "POST", body });
    const registeredBody = await registered.json();
    if (registered.status !== 201) {
      const possiblyCreated = await testPool.query("SELECT user_id FROM users WHERE email = $1", [email]);
      if (possiblyCreated.rows[0]) createdUserIds.push(possiblyCreated.rows[0].user_id);
    }
    assert.equal(registered.status, 201);
    assert.equal(registeredBody.data.email, email);
    assert.equal(registeredBody.data.email_verified, false);
    assert.equal("password_hash" in registeredBody.data, false);
    assert.equal(registeredBody.deliveryMode, "email");
    const emailedToken = new URLSearchParams(
      new URL(sentVerificationEmails.get(email)).hash.slice(1)
    ).get("token");
    assert.equal(JSON.stringify(registeredBody).includes(emailedToken), false);
    createdUserIds.push(registeredBody.data.user_id);

    const blockedLogin = await request("/api/auth/login", { method: "POST", body: { email, password } });
    const blockedBody = await blockedLogin.json();
    assert.equal(blockedLogin.status, 403);
    assert.equal(blockedBody.code, "EMAIL_NOT_VERIFIED");

    const verificationToken = await verifyAccount(email);
    const hashes = await testPool.query(
      "SELECT token_hash, consumed_at FROM email_verification_tokens WHERE user_id = $1",
      [registeredBody.data.user_id]
    );
    assert.equal(hashes.rowCount, 1);
    assert.deepEqual(hashes.rows[0].token_hash, crypto.createHash("sha256").update(Buffer.from(verificationToken, "base64url")).digest());
    assert.ok(hashes.rows[0].consumed_at);

    const repeatedVerification = await request("/api/auth/verify-email", {
      method: "POST", body: { token: verificationToken },
    });
    assert.equal(repeatedVerification.status, 400);

    const duplicate = await request("/api/auth/register", { method: "POST", body });
    assert.equal(duplicate.status, 409);
    const successfulLogin = await request("/api/auth/login", { method: "POST", body: { email, password } });
    const loginBody = await successfulLogin.json();
    assert.equal(successfulLogin.status, 200);
    assert.ok(loginBody.data.token);
    assert.equal("password_hash" in loginBody.data.user, false);
    const invalidLogin = await request("/api/auth/login", { method: "POST", body: { email, password: "incorrect" } });
    assert.equal(invalidLogin.status, 401);

    const unknownResend = await request("/api/auth/resend-verification", {
      method: "POST", body: { email: emailFor("unknown-resend") },
    });
    const verifiedResend = await request("/api/auth/resend-verification", {
      method: "POST", body: { email },
    });
    assert.equal(unknownResend.status, 202);
    assert.equal(verifiedResend.status, 202);
    assert.equal((await unknownResend.json()).message, (await verifiedResend.json()).message);

    const concurrentEmail = emailFor("concurrent-verification");
    const concurrentRegistration = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Concurrent Verification", email: concurrentEmail, password, role: "INDIVIDUAL" },
    });
    const concurrentBody = await concurrentRegistration.json();
    assert.equal(concurrentRegistration.status, 201);
    createdUserIds.push(concurrentBody.data.user_id);
    const concurrentToken = new URLSearchParams(
      new URL(sentVerificationEmails.get(concurrentEmail)).hash.slice(1)
    ).get("token");
    const concurrentResults = await Promise.all([
      request("/api/auth/verify-email", { method: "POST", body: { token: concurrentToken } }),
      request("/api/auth/verify-email", { method: "POST", body: { token: concurrentToken } }),
    ]);
    assert.deepEqual(concurrentResults.map((response) => response.status).sort(), [200, 400]);

    const resendEmail = emailFor("resend-verification");
    const resendRegistration = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Resend Verification", email: resendEmail, password, role: "INDIVIDUAL" },
    });
    const resendBody = await resendRegistration.json();
    assert.equal(resendRegistration.status, 201);
    createdUserIds.push(resendBody.data.user_id);
    const firstToken = new URLSearchParams(
      new URL(sentVerificationEmails.get(resendEmail)).hash.slice(1)
    ).get("token");
    await testPool.query(
      `UPDATE email_verification_tokens
       SET created_at = clock_timestamp() - INTERVAL '2 minutes'
       WHERE user_id = $1`,
      [resendBody.data.user_id]
    );
    const resendResponse = await request("/api/auth/resend-verification", {
      method: "POST", body: { email: resendEmail },
    });
    assert.equal(resendResponse.status, 202);
    const secondToken = new URLSearchParams(
      new URL(sentVerificationEmails.get(resendEmail)).hash.slice(1)
    ).get("token");
    assert.notEqual(firstToken, secondToken);
    assert.equal((await request("/api/auth/verify-email", {
      method: "POST", body: { token: firstToken },
    })).status, 400);
    assert.equal((await request("/api/auth/verify-email", {
      method: "POST", body: { token: secondToken },
    })).status, 200);

    const expiredEmail = emailFor("expired-verification");
    const expiredRegistration = await request("/api/auth/register", {
      method: "POST",
      body: { name: "Expired Verification", email: expiredEmail, password, role: "INDIVIDUAL" },
    });
    const expiredBody = await expiredRegistration.json();
    assert.equal(expiredRegistration.status, 201);
    createdUserIds.push(expiredBody.data.user_id);
    const expiredToken = new URLSearchParams(
      new URL(sentVerificationEmails.get(expiredEmail)).hash.slice(1)
    ).get("token");
    await testPool.query(
      `UPDATE email_verification_tokens
       SET created_at = clock_timestamp() - INTERVAL '2 minutes',
           expires_at = clock_timestamp() - INTERVAL '1 second'
       WHERE user_id = $1`,
      [expiredBody.data.user_id]
    );
    assert.equal((await request("/api/auth/verify-email", {
      method: "POST", body: { token: expiredToken },
    })).status, 400);

    individual = { userId: registeredBody.data.user_id, email, password, token: loginBody.data.token };
    applicant = await loginAccount(await registerAccount("applicant"));
    contributor = await loginAccount(await registerAccount("contributor"));
    matcher = await loginAccount(await registerAccount("matcher", "INDIVIDUAL", "Pune"));
    owner = await loginAccount(await registerAccount("owner", "NGO"));
    otherNgo = await loginAccount(await registerAccount("other-ngo", "NGO"));
    reviewRaceNgo = await loginAccount(await registerAccount("review-race", "NGO"));
  });

  await t.test("NGO profiles create, fetch, update, and enforce role restrictions", async () => {
    const created = await request("/api/ngos/me", { method: "POST", token: owner.token, body: ngoInput(`Integration Owner ${runId}`) });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.data.verification_status, "NOT_SUBMITTED");
    approvedNgo = createdBody.data;

    const otherCreated = await request("/api/ngos/me", { method: "POST", token: otherNgo.token, body: ngoInput(`Integration Other ${runId}`) });
    const otherBody = await otherCreated.json();
    assert.equal(otherCreated.status, 201);
    otherNgoProfile = otherBody.data;

    const raceCreated = await request("/api/ngos/me", {
      method: "POST", token: reviewRaceNgo.token, body: ngoInput(`Integration Race ${runId}`),
    });
    const raceBody = await raceCreated.json();
    assert.equal(raceCreated.status, 201);
    assert.equal(raceBody.data.verification_status, "NOT_SUBMITTED");
    raceNgoProfile = raceBody.data;

    const fetched = await request("/api/ngos/me", { token: owner.token });
    assert.equal(fetched.status, 200);
    assert.equal((await fetched.json()).data.ngo_id, approvedNgo.ngo_id);
    const otherFetched = await request("/api/ngos/me", { token: otherNgo.token });
    assert.equal(otherFetched.status, 200);
    assert.equal((await otherFetched.json()).data.ngo_id, otherNgoProfile.ngo_id);
    const updated = await request("/api/ngos/me", {
      method: "PUT", token: owner.token,
      body: { ...ngoInput(`Integration Owner Updated ${runId}`), phone: "555-0199" },
    });
    assert.equal(updated.status, 200);
    const updatedBody = await updated.json();
    assert.equal(updatedBody.data.phone, "555-0199");
    assert.equal(updatedBody.data.verification_status, "NOT_SUBMITTED");
    approvedNgo = updatedBody.data;

    assert.equal((await request("/api/ngos/me", { token: individual.token })).status, 403);
    assert.equal((await request("/api/ngos/me", { token: adminToken })).status, 403);
    assert.equal((await request("/api/ngos/me", { method: "POST", token: individual.token, body: ngoInput("Not an NGO") })).status, 403);
    assert.equal((await request("/api/ngos/me", { method: "POST", token: owner.token, body: { ...ngoInput("Protected"), verificationStatus: "APPROVED" } })).status, 400);
    assert.equal((await request("/api/ngos/me", {
      method: "PUT", token: owner.token,
      body: { ...ngoInput("Spoofed owner"), userId: otherNgo.userId },
    })).status, 400);
    const duplicateProfile = await request("/api/ngos/me", { method: "POST", token: owner.token, body: ngoInput("Duplicate") });
    assert.equal(duplicateProfile.status, 409);
    assert.notEqual(otherNgoProfile.ngo_id, approvedNgo.ngo_id);
  });

  await t.test("PostgreSQL NGO verification covers uploads, history, decisions, resubmission, and isolation", async () => {
    assert.equal((await request("/api/admin/ngos/pending?limit=100&offset=0")).status, 401);
    assert.equal((await request("/api/admin/ngos/pending", { token: individual.token })).status, 403);
    assert.equal((await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification`, { token: individual.token })).status, 403);

    const noCertificate = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: owner.token, body: makeVerificationForm({ certificate: false, optional: true }),
    });
    assert.equal(noCertificate.status, 400);
    assert.equal((await request("/api/ngos/me/verification/submissions", {
      method: "POST", body: makeVerificationForm(),
    })).status, 401);
    assert.equal((await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: individual.token, body: makeVerificationForm(),
    })).status, 403);

    const unsubmittedApproval = await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification`, {
      method: "PUT", token: adminToken, body: { verificationStatus: "APPROVED" },
    });
    assert.equal(unsubmittedApproval.status, 409);
    const unsubmittedRejection = await request(`/api/admin/ngos/${otherNgoProfile.ngo_id}/verification`, {
      method: "PUT", token: adminToken,
      body: { verificationStatus: "REJECTED", message: "No submission exists." },
    });
    assert.equal(unsubmittedRejection.status, 409);
    const stillUnsubmitted = await testPool.query(
      `SELECT verification_status FROM ngos WHERE ngo_id = ANY($1::uuid[]) ORDER BY ngo_id`,
      [[approvedNgo.ngo_id, otherNgoProfile.ngo_id]]
    );
    assert.equal(stillUnsubmitted.rowCount, 2);
    assert.ok(stillUnsubmitted.rows.every((row) => row.verification_status === "NOT_SUBMITTED"));

    const firstSubmissionResponse = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: owner.token, body: makeVerificationForm({ optional: true }),
    });
    const firstSubmissionBody = await firstSubmissionResponse.json();
    assert.equal(firstSubmissionResponse.status, 201, JSON.stringify(firstSubmissionBody));
    rememberSubmission(firstSubmissionBody);
    const ownerInitialSubmissionId = firstSubmissionBody.data.currentSubmission.submission_id;
    const submissionNotices = await testPool.query(
      `SELECT recipient_user_id, event_type FROM notifications
        WHERE related_entity_type = 'NGO_VERIFICATION' AND related_entity_id = $1`,
      [ownerInitialSubmissionId]
    );
    const activeAdminIds = await testPool.query("SELECT user_id FROM users WHERE role = 'ADMIN' AND NOT is_suspended ORDER BY user_id");
    assert.deepEqual(submissionNotices.rows.map((row) => row.recipient_user_id).sort(), [...activeAdminIds.rows.map((row) => row.user_id), owner.userId].sort());
    assert.ok(submissionNotices.rows.every((row) => row.event_type === "NGO_VERIFICATION_SUBMITTED"));
    assert.equal(firstSubmissionBody.data.ngo.verification_status, "PENDING");
    assert.equal(firstSubmissionBody.data.currentSubmission.status, "PENDING");
    assert.deepEqual(
      firstSubmissionBody.data.currentSubmission.documents.map((document) => document.document_type).sort(),
      ["NGO_DARPAN", "PAN", "REGISTRATION_CERTIFICATE", "SUPPORTING_DOCUMENT"]
    );
    const persistedDocuments = await testPool.query(
      `SELECT document_type, storage_provider, storage_key, size_bytes,
              octet_length(sha256) AS checksum_size
         FROM ngo_verification_documents
        WHERE submission_id_snapshot = $1
        ORDER BY document_type`,
      [ownerInitialSubmissionId]
    );
    assert.equal(persistedDocuments.rowCount, 4);
    assert.ok(persistedDocuments.rows.every((document) =>
      document.storage_provider === "INTEGRATION_TEST_PRIVATE"
      && /^[0-9a-f-]{36}\.(pdf|jpg|png)$/.test(document.storage_key)
      && document.size_bytes > 0
      && document.checksum_size === 32
    ));
    for (const field of ["storage_key", "storage_provider", "sha256"]) {
      assert.equal(field in firstSubmissionBody.data.currentSubmission.documents[0], false);
    }

    const secondSubmissionResponse = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: otherNgo.token, body: makeVerificationForm(),
    });
    const secondSubmissionBody = await secondSubmissionResponse.json();
    assert.equal(secondSubmissionResponse.status, 201, JSON.stringify(secondSubmissionBody));
    rememberSubmission(secondSubmissionBody);
    const otherSubmissionId = secondSubmissionBody.data.currentSubmission.submission_id;

    const ownerStatus = await request("/api/ngos/me/verification", { token: owner.token });
    const ownerStatusBody = await ownerStatus.json();
    assert.equal(ownerStatus.status, 200);
    assert.equal(ownerStatusBody.data.ngo.verification_status, "PENDING");
    assert.equal("storage_key" in ownerStatusBody.data.currentSubmission.documents[0], false);
    assert.deepEqual(ownerStatusBody.data.history.map((event) => event.action), ["SUBMITTED"]);
    const otherStatus = await request("/api/ngos/me/verification", { token: otherNgo.token });
    assert.equal((await otherStatus.json()).data.ngo.ngo_id, otherNgoProfile.ngo_id);

    const adminDetailResponse = await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification`, { token: adminToken });
    const adminDetail = await adminDetailResponse.json();
    assert.equal(adminDetailResponse.status, 200);
    assert.equal(adminDetail.data.currentSubmission.submission_id, ownerInitialSubmissionId);
    const certificate = adminDetail.data.currentSubmission.documents.find((document) => document.document_type === "REGISTRATION_CERTIFICATE");
    assert.ok(certificate);
    assert.equal((await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification/documents/${certificate.document_id}`)).status, 401);
    assert.equal((await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification/documents/${certificate.document_id}`, { token: individual.token })).status, 403);
    const downloadedCertificate = await request(
      `/api/admin/ngos/${approvedNgo.ngo_id}/verification/documents/${certificate.document_id}`,
      { token: adminToken }
    );
    assert.equal(downloadedCertificate.status, 200);
    assert.match(Buffer.from(await downloadedCertificate.arrayBuffer()).toString(), /^%PDF-/);
    assert.equal((await request(
      `/api/admin/ngos/${otherNgoProfile.ngo_id}/verification/documents/${certificate.document_id}`,
      { token: adminToken }
    )).status, 404);

    const listResponse = await request("/api/admin/ngos/pending?limit=100&offset=0", { token: adminToken });
    const listBody = await listResponse.json();
    assert.equal(listResponse.status, 200);
    assert.ok(listBody.data.items.some((ngo) => ngo.ngo_id === approvedNgo.ngo_id));
    assert.ok(listBody.data.items.some((ngo) => ngo.ngo_id === otherNgoProfile.ngo_id));

    const missingRejectionMessage = await request(`/api/admin/ngos/${otherNgoProfile.ngo_id}/verification/reject`, {
      method: "POST", token: adminToken, body: { message: "   " },
    });
    assert.equal(missingRejectionMessage.status, 400);

    const infoRequest = await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification/request-info`, {
      method: "POST", token: adminToken, body: { message: "Please provide a clearer registration certificate." },
    });
    assert.equal(infoRequest.status, 200);
    assert.equal((await infoRequest.json()).data.verification_status, "NEEDS_INFO");
    const infoNotice = await testPool.query(
      `SELECT event_type FROM notifications WHERE recipient_user_id = $1 AND related_entity_id = $2`,
      [owner.userId, ownerInitialSubmissionId]
    );
    assert.ok(infoNotice.rows.some((row) => row.event_type === "NGO_VERIFICATION_NEEDS_INFO"));
    const resubmissionResponse = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: owner.token, body: makeVerificationForm(),
    });
    const resubmissionBody = await resubmissionResponse.json();
    assert.equal(resubmissionResponse.status, 201, JSON.stringify(resubmissionBody));
    rememberSubmission(resubmissionBody);
    const ownerResubmittedSubmissionId = resubmissionBody.data.currentSubmission.submission_id;
    assert.equal(resubmissionBody.data.currentSubmission.submission_number, 2);
    assert.deepEqual(resubmissionBody.data.history.map((event) => event.action), ["SUBMITTED", "INFO_REQUESTED", "RESUBMITTED"]);
    const superseded = await testPool.query(
      "SELECT status, is_current FROM ngo_verification_submissions WHERE submission_id = $1",
      [ownerInitialSubmissionId]
    );
    assert.equal(superseded.rows[0].status, "SUPERSEDED");
    assert.equal(superseded.rows[0].is_current, false);

    // Preserve the previous PUT API as a compatible approval path.
    const approval = await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification`, {
      method: "PUT", token: adminToken,
      body: { verificationStatus: "APPROVED", message: "Integration approval decision." },
    });
    assert.equal(approval.status, 200);
    assert.equal((await approval.json()).data.verification_status, "APPROVED");
    const approvedState = await testPool.query(
      `SELECT g.verification_status, s.status, s.is_current,
              h.action, h.actor_user_id_snapshot, h.message
         FROM ngos g
         JOIN ngo_verification_submissions s ON s.ngo_id_snapshot = g.ngo_id AND s.is_current
         JOIN ngo_verification_history h ON h.submission_id_snapshot = s.submission_id
        WHERE g.ngo_id = $1 AND s.submission_id = $2 AND h.action = 'APPROVED'`,
      [approvedNgo.ngo_id, ownerResubmittedSubmissionId]
    );
    assert.equal(approvedState.rows[0].verification_status, "APPROVED");
    assert.equal(approvedState.rows[0].status, "APPROVED");
    assert.equal(approvedState.rows[0].is_current, true);
    assert.equal(approvedState.rows[0].actor_user_id_snapshot, adminUserId);
    assert.equal(approvedState.rows[0].message, "Integration approval decision.");

    const rejection = await request(`/api/admin/ngos/${otherNgoProfile.ngo_id}/verification/reject`, {
      method: "POST", token: adminToken, body: { message: "Integration rejection reason." },
    });
    assert.equal(rejection.status, 200);
    assert.equal((await rejection.json()).data.verification_status, "REJECTED");
    const rejectionNotice = await testPool.query(
      `SELECT event_type FROM notifications WHERE recipient_user_id = $1 AND related_entity_id = $2`,
      [otherNgo.userId, otherSubmissionId]
    );
    assert.ok(rejectionNotice.rows.some((row) => row.event_type === "NGO_VERIFICATION_REJECTED"));
    const rejectedSubmission = await testPool.query(
      `SELECT g.verification_status, s.status, s.is_current,
              h.action, h.actor_user_id_snapshot, h.message
         FROM ngos g
         JOIN ngo_verification_submissions s ON s.ngo_id_snapshot = g.ngo_id AND s.is_current
         JOIN ngo_verification_history h ON h.submission_id_snapshot = s.submission_id
        WHERE s.submission_id = $1 AND h.action = 'REJECTED'`,
      [otherSubmissionId]
    );
    assert.equal(rejectedSubmission.rows[0].verification_status, "REJECTED");
    assert.equal(rejectedSubmission.rows[0].status, "REJECTED");
    assert.equal(rejectedSubmission.rows[0].is_current, true);
    assert.equal(rejectedSubmission.rows[0].actor_user_id_snapshot, adminUserId);
    assert.equal(rejectedSubmission.rows[0].message, "Integration rejection reason.");
    const rejectedStatusResponse = await request("/api/ngos/me/verification", { token: otherNgo.token });
    const rejectedStatus = await rejectedStatusResponse.json();
    assert.equal(rejectedStatusResponse.status, 200);
    assert.equal(rejectedStatus.data.ngo.verification_status, "REJECTED");
    assert.deepEqual(rejectedStatus.data.history.map((event) => event.action), ["SUBMITTED", "REJECTED"]);

    const rejectedResubmissionResponse = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: otherNgo.token, body: makeVerificationForm({ optional: true }),
    });
    const rejectedResubmission = await rejectedResubmissionResponse.json();
    assert.equal(rejectedResubmissionResponse.status, 201, JSON.stringify(rejectedResubmission));
    rememberSubmission(rejectedResubmission);
    assert.equal(rejectedResubmission.data.ngo.verification_status, "PENDING");
    assert.equal(rejectedResubmission.data.currentSubmission.submission_number, 2);
    assert.deepEqual(rejectedResubmission.data.history.map((event) => event.action), [
      "SUBMITTED", "REJECTED", "RESUBMITTED",
    ]);
    const rejectedLifecycle = await testPool.query(
      `SELECT status, is_current FROM ngo_verification_submissions
        WHERE ngo_id_snapshot = $1 ORDER BY submission_number`,
      [otherNgoProfile.ngo_id]
    );
    assert.deepEqual(rejectedLifecycle.rows, [
      { status: "SUPERSEDED", is_current: false },
      { status: "PENDING", is_current: true },
    ]);

    const raceSubmissionResponse = await request("/api/ngos/me/verification/submissions", {
      method: "POST", token: reviewRaceNgo.token, body: makeVerificationForm(),
    });
    const raceSubmissionBody = await raceSubmissionResponse.json();
    assert.equal(raceSubmissionResponse.status, 201, JSON.stringify(raceSubmissionBody));
    rememberSubmission(raceSubmissionBody);
    raceNgoProfile = raceSubmissionBody.data.ngo;
    const raceSubmissionId = raceSubmissionBody.data.currentSubmission.submission_id;
    const competingDecisions = await Promise.all([
      request(`/api/admin/ngos/${raceNgoProfile.ngo_id}/verification/approve`, { method: "POST", token: adminToken }),
      request(`/api/admin/ngos/${raceNgoProfile.ngo_id}/verification/reject`, {
        method: "POST", token: adminToken, body: { message: "Concurrent rejection." },
      }),
    ]);
    assert.deepEqual(competingDecisions.map(({ status }) => status).sort(), [200, 409]);
    const raceState = await testPool.query(
      `SELECT g.verification_status, s.status, s.is_current,
              count(h.history_id) FILTER (WHERE h.action IN ('APPROVED', 'REJECTED'))::int AS decision_count
         FROM ngos g
         JOIN ngo_verification_submissions s ON s.ngo_id_snapshot = g.ngo_id AND s.is_current
         LEFT JOIN ngo_verification_history h ON h.submission_id_snapshot = s.submission_id
        WHERE s.submission_id = $1
        GROUP BY g.verification_status, s.status, s.is_current`,
      [raceSubmissionId]
    );
    assert.equal(raceState.rows[0].status, raceState.rows[0].verification_status);
    assert.equal(raceState.rows[0].is_current, true);
    assert.equal(raceState.rows[0].decision_count, 1);

    assert.equal((await request(`/api/admin/ngos/not-a-uuid/verification`, {
      method: "PUT", token: adminToken, body: { verificationStatus: "APPROVED" },
    })).status, 400);
    assert.equal((await request(`/api/admin/ngos/${approvedNgo.ngo_id}/verification`, {
      method: "PUT", token: adminToken, body: { verificationStatus: "PENDING" },
    })).status, 400);
  });

  await t.test("individual cause and skill preferences support CRUD, conflicts, and invalid IDs", async () => {
    const initial = await request("/api/users/me/preferences", { token: individual.token });
    assert.equal(initial.status, 200);
    assert.deepEqual((await initial.json()).data, { causes: [], skills: [] });

    const addCause = await request("/api/users/me/causes", { method: "POST", token: individual.token, body: { causeId } });
    assert.equal(addCause.status, 201);
    assert.equal((await request("/api/users/me/causes", { method: "POST", token: individual.token, body: { causeId } })).status, 409);
    assert.equal((await request("/api/users/me/causes", { method: "POST", token: individual.token, body: { causeId: "not-a-uuid" } })).status, 400);
    assert.equal((await request("/api/users/me/causes", { method: "POST", token: individual.token, body: { causeId: "20000000-0000-4000-8000-000000000099" } })).status, 404);
    assert.equal((await request(`/api/users/me/causes/${causeId}`, { method: "DELETE", token: individual.token })).status, 200);
    assert.equal((await request(`/api/users/me/causes/${causeId}`, { method: "DELETE", token: individual.token })).status, 404);
    assert.equal((await request(`/api/users/me/causes/not-a-uuid`, { method: "DELETE", token: individual.token })).status, 400);
    assert.equal((await request("/api/users/me/causes", { method: "POST", token: owner.token, body: { causeId } })).status, 403);
    assert.equal((await request("/api/users/me/causes", { method: "POST", body: { causeId } })).status, 401);
    assert.equal((await request("/api/users/me/causes", { method: "POST", token: individual.token, body: { causeId } })).status, 201);

    const addSkill = await request("/api/users/me/skills", { method: "POST", token: individual.token, body: { skillId, proficiencyLevel: "BEGINNER" } });
    assert.equal(addSkill.status, 201);
    assert.equal((await request("/api/users/me/skills", { method: "POST", token: individual.token, body: { skillId } })).status, 409);
    assert.equal((await request("/api/users/me/skills", { method: "POST", token: individual.token, body: { skillId: "not-a-uuid" } })).status, 400);
    assert.equal((await request("/api/users/me/skills", { method: "POST", token: individual.token, body: { skillId: "20000000-0000-4000-8000-000000000098" } })).status, 404);
    assert.equal((await request(`/api/users/me/skills/${skillId}`, { method: "PUT", token: individual.token, body: { proficiencyLevel: "ADVANCED" } })).status, 200);
    const preferences = (await (await request("/api/users/me/preferences", { token: individual.token })).json()).data;
    assert.ok(preferences.causes.some((cause) => cause.cause_id === causeId));
    assert.equal(preferences.skills.find((skill) => skill.skill_id === skillId).proficiency_level, "ADVANCED");
    assert.equal((await request(`/api/users/me/skills/not-a-uuid`, { method: "DELETE", token: individual.token })).status, 400);
    assert.equal((await request(`/api/users/me/skills/${skillId}`, { method: "DELETE", token: individual.token })).status, 200);
    assert.equal((await request(`/api/users/me/skills/${skillId}`, { method: "DELETE", token: individual.token })).status, 404);
    assert.equal((await request("/api/users/me/skills", { method: "POST", token: individual.token, body: { skillId, proficiencyLevel: "ADVANCED" } })).status, 201);
  });

  await t.test("volunteer applications enforce uniqueness, ownership, and forward-only transitions", async () => {
    volunteerNeed = await createNeed(owner, { title: "Volunteer fixture", type: "VOLUNTEER", quantity: null });
    const applicationResponse = await request(`/api/needs/${volunteerNeed.need_id}/applications`, {
      method: "POST", token: applicant.token, body: { message: "I can help on weekends." },
    });
    const applicationBody = await applicationResponse.json();
    assert.equal(applicationResponse.status, 201);
    assert.equal(applicationBody.data.status, "APPLIED");
    const applicationId = applicationBody.data.application_id;
    createdApplicationIds.push(applicationId);
    const receivedNotice = await testPool.query(
      "SELECT recipient_user_id, event_type FROM notifications WHERE related_entity_type = 'APPLICATION' AND related_entity_id = $1",
      [applicationId]
    );
    assert.deepEqual(receivedNotice.rows, [{ recipient_user_id: owner.userId, event_type: "APPLICATION_RECEIVED" }]);
    assert.equal((await request(`/api/engagements/applications/${applicationId}/contact`, { token: applicant.token })).status, 403);
    assert.equal((await request(`/api/engagements/applications/${applicationId}/contact`, { token: matcher.token })).status, 404);
    const myApplications = await request("/api/users/me/applications", { token: applicant.token });
    assert.equal(myApplications.status, 200);
    const myApplicationData = (await myApplications.json()).data;
    assert.equal(myApplicationData.length, 1);
    assert.equal(myApplicationData[0].application_id, applicationId);
    assert.equal(myApplicationData[0].need_id, volunteerNeed.need_id);
    assert.equal(myApplicationData[0].status, "APPLIED");
    assert.equal(myApplicationData[0].need_title, volunteerNeed.title);
    assert.equal(myApplicationData[0].ngo_name, approvedNgo.name);
    assert.equal(myApplicationData[0].message, "I can help on weekends.");
    assert.equal("user_id" in myApplicationData[0], false);
    const otherIndividualApplications = await request("/api/users/me/applications", { token: matcher.token });
    assert.equal(otherIndividualApplications.status, 200);
    assert.deepEqual((await otherIndividualApplications.json()).data, []);
    assert.equal((await request("/api/users/me/applications")).status, 401);
    assert.equal((await request("/api/users/me/applications", { token: owner.token })).status, 403);
    assert.equal((await request("/api/users/me/applications", { token: adminToken })).status, 403);
    const noticesBeforeFailedApplication = await testPool.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE related_entity_type = 'APPLICATION' AND related_entity_id = $1",
      [applicationId]
    );
    assert.equal((await request(`/api/needs/${volunteerNeed.need_id}/applications`, {
      method: "POST", token: applicant.token, body: {},
    })).status, 409);
    const noticesAfterFailedApplication = await testPool.query(
      "SELECT COUNT(*)::int AS count FROM notifications WHERE related_entity_type = 'APPLICATION' AND related_entity_id = $1",
      [applicationId]
    );
    assert.equal(noticesAfterFailedApplication.rows[0].count, noticesBeforeFailedApplication.rows[0].count);
    assert.equal((await request(`/api/needs/not-a-uuid/applications`, { method: "POST", token: applicant.token, body: {} })).status, 400);
    assert.equal((await request(`/api/needs/${volunteerNeed.need_id}/applications`, { method: "POST", token: owner.token, body: {} })).status, 403);
    assert.equal((await request(`/api/needs/${volunteerNeed.need_id}/applications`)).status, 401);

    const listed = await request(`/api/needs/${volunteerNeed.need_id}/applications`, { token: owner.token });
    assert.equal(listed.status, 200);
    assert.ok((await listed.json()).data.some((row) => row.application_id === applicationId));
    assert.equal((await request(`/api/needs/${volunteerNeed.need_id}/applications`, { token: otherNgo.token })).status, 403);
    assert.equal((await request(`/api/needs/${volunteerNeed.need_id}/applications/${applicationId}`, {
      method: "PUT", token: owner.token, body: { status: "COMPLETED" },
    })).status, 409);
    const accepted = await request(`/api/needs/${volunteerNeed.need_id}/applications/${applicationId}`, {
      method: "PUT", token: owner.token, body: { status: "ACCEPTED" },
    });
    assert.equal(accepted.status, 200);
    const acceptedNotices = await testPool.query(
      "SELECT recipient_user_id, event_type FROM notifications WHERE related_entity_type = 'APPLICATION' AND related_entity_id = $1 AND event_type = 'APPLICATION_ACCEPTED'",
      [applicationId]
    );
    assert.deepEqual(acceptedNotices.rows.map((row) => row.recipient_user_id).sort(), [applicant.userId, owner.userId].sort());
    const applicantContact = await request(`/api/engagements/applications/${applicationId}/contact`, { token: applicant.token });
    const ownerContact = await request(`/api/engagements/applications/${applicationId}/contact`, { token: owner.token });
    assert.equal(applicantContact.status, 200);
    assert.equal((await applicantContact.json()).data.email, approvedNgo.email);
    assert.equal(ownerContact.status, 200);
    assert.equal((await ownerContact.json()).data.email, applicant.email);
    assert.equal((await request(`/api/engagements/applications/${applicationId}/contact`, { token: otherNgo.token })).status, 404);
    const completed = await request(`/api/needs/${volunteerNeed.need_id}/applications/${applicationId}`, {
      method: "PUT", token: owner.token, body: { status: "COMPLETED" },
    });
    assert.equal(completed.status, 200);
    assert.equal((await completed.json()).data.status, "COMPLETED");
    const completedNotice = await testPool.query(
      "SELECT recipient_user_id, event_type FROM notifications WHERE related_entity_id = $1 AND event_type = 'APPLICATION_COMPLETED'",
      [applicationId]
    );
    assert.deepEqual(completedNotice.rows, [{ recipient_user_id: applicant.userId, event_type: "APPLICATION_COMPLETED" }]);
    const refreshedMyApplications = await request("/api/users/me/applications", { token: applicant.token });
    assert.equal((await refreshedMyApplications.json()).data[0].status, "COMPLETED");

    const secondApplication = await request(`/api/needs/${volunteerNeed.need_id}/applications`, {
      method: "POST", token: matcher.token, body: {},
    });
    assert.equal(secondApplication.status, 201);
    const secondId = (await secondApplication.json()).data.application_id;
    createdApplicationIds.push(secondId);
    const rejected = await request(`/api/needs/${volunteerNeed.need_id}/applications/${secondId}`, {
      method: "PUT", token: owner.token, body: { status: "REJECTED" },
    });
    assert.equal(rejected.status, 200);
    assert.equal((await rejected.json()).data.status, "REJECTED");
    const rejectedNotices = await testPool.query(
      "SELECT recipient_user_id FROM notifications WHERE related_entity_id = $1 AND event_type = 'APPLICATION_REJECTED'",
      [secondId]
    );
    assert.deepEqual(rejectedNotices.rows.map((row) => row.recipient_user_id).sort(), [matcher.userId, owner.userId].sort());
    assert.equal((await request(`/api/engagements/applications/${secondId}/contact`, { token: matcher.token })).status, 403);
  });

  await t.test("contributions enforce reservations, fulfillment, external money support, and duplicate rules", async () => {
    materialNeed = await createNeed(owner, { title: "Material fixture", type: "MATERIAL", quantity: 5 });
    moneyNeed = await createNeed(owner, { title: "Money fixture", type: "MONEY", quantity: null });
    const invalid = await request(`/api/needs/${materialNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token, body: { contributionType: "MATERIAL" },
    });
    assert.equal(invalid.status, 400);

    const createMaterial = (account, quantity = 3) => request(`/api/needs/${materialNeed.need_id}/contributions`, {
      method: "POST", token: account.token, body: { contributionType: "MATERIAL", quantity, description: "Boxes" },
    });
    const firstResponse = await createMaterial(contributor);
    const firstPayload = await firstResponse.json();
    assert.equal(firstResponse.status, 201);
    const firstId = firstPayload.data.contribution_id;
    createdContributionIds.push(firstId);
    const contributionReceivedNotice = await testPool.query(
      "SELECT recipient_user_id, event_type FROM notifications WHERE related_entity_type = 'CONTRIBUTION' AND related_entity_id = $1",
      [firstId]
    );
    assert.deepEqual(contributionReceivedNotice.rows, [{ recipient_user_id: owner.userId, event_type: "CONTRIBUTION_RECEIVED" }]);
    assert.equal((await request(`/api/engagements/contributions/${firstId}/contact`, { token: contributor.token })).status, 403);
    const duplicatePending = await createMaterial(contributor);
    assert.equal(duplicatePending.status, 409);
    assert.match((await duplicatePending.json()).message, /already have a non-rejected contribution/);
    const secondResponse = await createMaterial(applicant, 2);
    const secondId = (await secondResponse.json()).data.contribution_id;
    assert.equal(secondResponse.status, 201);
    createdContributionIds.push(secondId);
    assert.equal((await request(`/api/needs/${materialNeed.need_id}/contributions`, { token: owner.token })).status, 200);
    assert.equal((await request(`/api/needs/${materialNeed.need_id}/contributions`, { token: otherNgo.token })).status, 403);
    assert.equal((await request(`/api/needs/${materialNeed.need_id}/contributions`, { token: contributor.token })).status, 403);

    const setContributionStatus = (needId, contributionId, status) => request(
      `/api/needs/${needId}/contributions/${contributionId}/status`,
      { method: "PUT", token: owner.token, body: { status } }
    );
    assert.equal((await setContributionStatus(materialNeed.need_id, firstId, "COMPLETED")).status, 409);
    assert.equal((await setContributionStatus(materialNeed.need_id, firstId, "ACCEPTED")).status, 200);
    let contributionStatusNotices = await testPool.query(
      "SELECT recipient_user_id FROM notifications WHERE related_entity_id = $1 AND event_type = 'CONTRIBUTION_ACCEPTED'",
      [firstId]
    );
    assert.deepEqual(contributionStatusNotices.rows.map((row) => row.recipient_user_id).sort(), [contributor.userId, owner.userId].sort());
    const volunteerContact = await request(`/api/engagements/contributions/${firstId}/contact`, { token: contributor.token });
    const ngoContact = await request(`/api/engagements/contributions/${firstId}/contact`, { token: owner.token });
    assert.equal(volunteerContact.status, 200);
    assert.equal((await volunteerContact.json()).data.email, approvedNgo.email);
    assert.equal(ngoContact.status, 200);
    assert.equal((await ngoContact.json()).data.email, contributor.email);
    assert.equal((await request(`/api/engagements/contributions/${firstId}/contact`, { token: applicant.token })).status, 404);
    const secondAcceptance = await setContributionStatus(materialNeed.need_id, secondId, "ACCEPTED");
    assert.equal(secondAcceptance.status, 200); // 3 + 2 exactly reserves the target.
    const fullyReservedNeed = await request(`/api/needs/${materialNeed.need_id}`);
    const fullyReservedNeedBody = await fullyReservedNeed.json();
    assert.equal(Number(fullyReservedNeedBody.data.quantity_reserved), 5);
    assert.equal(Number(fullyReservedNeedBody.data.quantity_available), 0);
    assert.equal((await setContributionStatus(materialNeed.need_id, firstId, "IN_PROGRESS")).status, 200);
    assert.equal((await setContributionStatus(materialNeed.need_id, firstId, "COMPLETED")).status, 200);
    contributionStatusNotices = await testPool.query(
      "SELECT event_type FROM notifications WHERE related_entity_id = $1 AND recipient_user_id = $2 ORDER BY event_type",
      [firstId, contributor.userId]
    );
    assert.deepEqual(contributionStatusNotices.rows.map((row) => row.event_type).sort(), ["CONTRIBUTION_ACCEPTED", "CONTRIBUTION_COMPLETED", "CONTRIBUTION_IN_PROGRESS"].sort());
    assert.equal((await setContributionStatus(materialNeed.need_id, secondId, "IN_PROGRESS")).status, 200);
    const afterFirstCompletion = await testPool.query(
      `SELECT n.quantity_fulfilled,
              COALESCE((SELECT SUM(c.quantity) FROM contributions c
                        WHERE c.need_id = n.need_id AND c.contribution_type = 'MATERIAL'
                          AND c.status IN ('ACCEPTED', 'IN_PROGRESS')), 0) AS reserved
         FROM needs n WHERE n.need_id = $1`, [materialNeed.need_id]
    );
    assert.equal(afterFirstCompletion.rows[0].quantity_fulfilled, 3);
    assert.equal(Number(afterFirstCompletion.rows[0].reserved), 2);
    assert.equal((await setContributionStatus(materialNeed.need_id, secondId, "COMPLETED")).status, 200);
    const storedNeed = await testPool.query("SELECT quantity_fulfilled FROM needs WHERE need_id = $1", [materialNeed.need_id]);
    const storedContribution = await testPool.query("SELECT status FROM contributions WHERE contribution_id = $1", [secondId]);
    assert.equal(storedNeed.rows[0].quantity_fulfilled, 5);
    assert.equal(storedContribution.rows[0].status, "COMPLETED");

    const raceNeed = await createNeed(owner, { title: "Concurrent material reservations", type: "MATERIAL", quantity: 5 });
    const raceFirst = await request(`/api/needs/${raceNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token, body: { contributionType: "MATERIAL", quantity: 4 },
    });
    const raceSecond = await request(`/api/needs/${raceNeed.need_id}/contributions`, {
      method: "POST", token: applicant.token, body: { contributionType: "MATERIAL", quantity: 4 },
    });
    assert.equal(raceFirst.status, 201);
    assert.equal(raceSecond.status, 201);
    const raceFirstId = (await raceFirst.json()).data.contribution_id;
    const raceSecondId = (await raceSecond.json()).data.contribution_id;
    createdContributionIds.push(raceFirstId, raceSecondId);
    const acceptanceRace = await Promise.all([
      setContributionStatus(raceNeed.need_id, raceFirstId, "ACCEPTED"),
      setContributionStatus(raceNeed.need_id, raceSecondId, "ACCEPTED"),
    ]);
    assert.deepEqual(acceptanceRace.map((response) => response.status).sort(), [200, 409]);

    const publicMoneyNeed = await request(`/api/needs/${moneyNeed.need_id}`);
    const publicMoneyPayload = await publicMoneyNeed.json();
    assert.equal(publicMoneyNeed.status, 200);
    assert.equal(publicMoneyPayload.data.ngo_website_url, "https://example.test/ngo");
    assert.equal(publicMoneyPayload.data.ngo_contact_email, approvedNgo.email);

    const money = await request(`/api/needs/${moneyNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token, body: { contributionType: "MONEY", amount: 25.5, description: "Pledge only" },
    });
    assert.equal(money.status, 400);
    assert.match((await money.json()).message, /arranged directly with the NGO/);

    const ownHistory = await request("/api/users/me/contributions", { token: contributor.token });
    assert.equal(ownHistory.status, 200);
    const moneyHistory = (await ownHistory.json()).data.filter((item) => item.need_id === moneyNeed.need_id);
    assert.deepEqual(moneyHistory, []);

    const skillNeed = await createNeed(owner, { title: "Concurrent skill fixture", type: "SKILL", quantity: null });
    const createSkill = () => request(`/api/needs/${skillNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token,
      body: { contributionType: "SKILL", description: "Concurrent submission test" },
    });
    const concurrent = await Promise.all([createSkill(), createSkill()]);
    assert.deepEqual(concurrent.map((result) => result.status).sort(), [201, 409]);
    for (const result of concurrent) {
      if (result.status === 201) createdContributionIds.push((await result.json()).data.contribution_id);
    }
  });

  await t.test("matching ranks eligible recommendations, paginates, and excludes unapproved NGO needs", async () => {
    assert.equal((await request("/api/users/me/causes", {
      method: "POST", token: matcher.token, body: { causeId },
    })).status, 201);
    assert.equal((await request("/api/users/me/skills", {
      method: "POST", token: matcher.token, body: { skillId, proficiencyLevel: "ADVANCED" },
    })).status, 201);
    const highSkillNeed = await createNeed(owner, { title: "Matching skilled urgent", type: "SKILL", priority: "URGENT" });
    const preferredNeed = await createNeed(owner, { title: "Matching preferred low", type: "VOLUNTEER", priority: "LOW" });
    const alternateNeed = await createNeed(owner, { title: "Matching alternate urgent", type: "VOLUNTEER", cause: alternateCauseId, priority: "URGENT" });
    const draftResponse = await request("/api/needs", {
      method: "POST", token: owner.token,
      body: {
        causeId, title: `${runId.slice(0, 8)} Matching draft`, description: "Draft must not be recommended.",
        contributionType: "VOLUNTEER", location: null, availability: null, quantityRequired: null,
        priority: "URGENT", deadline: null, status: "DRAFT",
      },
    });
    assert.equal(draftResponse.status, 201);
    const draftNeedId = (await draftResponse.json()).data.need_id;
    createdNeedIds.push(draftNeedId);
    const expiredNeed = await createNeed(owner, {
      title: "Matching expired", type: "VOLUNTEER", priority: "URGENT", deadline: new Date(Date.now() + 60000).toISOString(),
    });
    await testPool.query("UPDATE needs SET deadline = clock_timestamp() - INTERVAL '1 second' WHERE need_id = $1", [expiredNeed.need_id]);

    await testPool.query(
      "INSERT INTO need_skills (need_id, skill_id, required_level) VALUES ($1, $2, 'ADVANCED')",
      [highSkillNeed.need_id, skillId]
    );
    const unapprovedNeedResult = await testPool.query(
      `INSERT INTO needs (ngo_id, cause_id, title, description, contribution_type, priority, deadline, status)
       VALUES ($1, $2, $3, $4, 'SKILL', 'URGENT', NULL, 'ACTIVE') RETURNING need_id`,
      [otherNgoProfile.ngo_id, causeId, `${runId.slice(0, 8)} Unapproved matching need`, "Must be excluded."]
    );
    const unapprovedNeedId = unapprovedNeedResult.rows[0].need_id;
    createdNeedIds.push(unapprovedNeedId);
    await testPool.query(
      "INSERT INTO need_skills (need_id, skill_id, required_level) VALUES ($1, $2, 'ADVANCED')",
      [unapprovedNeedId, skillId]
    );

    const fullResponse = await request("/api/matching/recommendations?limit=100&offset=0", { token: matcher.token });
    assert.equal(fullResponse.status, 200);
    const fullItems = (await fullResponse.json()).data.items;
    const highItem = fullItems.find((item) => item.need_id === highSkillNeed.need_id);
    const preferredItem = fullItems.find((item) => item.need_id === preferredNeed.need_id);
    const alternateItem = fullItems.find((item) => item.need_id === alternateNeed.need_id);
    assert.ok(highItem && preferredItem && alternateItem);
    assert.ok(highItem.score > preferredItem.score);
    assert.ok(preferredItem.score > alternateItem.score);
    assert.ok(highItem.reasons.some((reason) => reason.includes("cause preference")));
    assert.ok(highItem.reasons.some((reason) => reason.includes("Skill match")));
    assert.ok(!fullItems.some((item) => [draftNeedId, expiredNeed.need_id, unapprovedNeedId].includes(item.need_id)));

    const firstPage = await request("/api/matching/recommendations?limit=1&offset=0", { token: matcher.token });
    const firstPageBody = (await firstPage.json()).data;
    assert.equal(firstPage.status, 200);
    assert.equal(firstPageBody.items[0].need_id, fullItems[0].need_id);
    assert.ok(firstPageBody.pagination.total >= fullItems.length);
    const secondPage = await request("/api/matching/recommendations?limit=1&offset=1", { token: matcher.token });
    const secondPageBody = (await secondPage.json()).data;
    assert.equal(secondPage.status, 200);
    assert.equal(secondPageBody.items[0].need_id, fullItems[1].need_id);
  });

  await t.test("individual dashboard and profile remain scoped to the authenticated account", async () => {
    const dashboardResponse = await request("/api/users/me/dashboard", { token: applicant.token });
    assert.equal(dashboardResponse.status, 200);
    const dashboard = (await dashboardResponse.json()).data;
    assert.deepEqual({ pending: dashboard.pending, accepted: dashboard.accepted, in_progress: dashboard.in_progress, completed: dashboard.completed }, {
      pending: 1, accepted: 0, in_progress: 0, completed: 2,
    });
    assert.equal(dashboard.recent_activity.length, 3);
    const ownApplicationRow = await testPool.query(
      "SELECT application_id FROM volunteer_applications WHERE user_id = $1 AND need_id = $2",
      [applicant.userId, volunteerNeed.need_id]
    );
    assert.ok(dashboard.recent_activity.some((item) => item.engagement_id === ownApplicationRow.rows[0].application_id));
    assert.equal("user_id" in dashboard.recent_activity[0], false);
    const emptyAccount = await loginAccount(await registerAccount("dashboard-empty"));
    const unrelated = await request("/api/users/me/dashboard", { token: emptyAccount.token });
    assert.equal(unrelated.status, 200);
    assert.deepEqual((await unrelated.json()).data.recent_activity, []);
    assert.equal((await request("/api/users/me/dashboard")).status, 401);
    assert.equal((await request("/api/users/me/dashboard", { token: owner.token })).status, 403);
    assert.equal((await request("/api/users/me/dashboard", { token: adminToken })).status, 403);

    const before = await request("/api/users/me", { token: applicant.token });
    const beforeData = (await before.json()).data;
    const update = await request("/api/users/me", {
      method: "PUT", token: applicant.token,
      body: { name: "Updated Applicant", phone: "555-0188", city: "Nashik", availability: beforeData.availability },
    });
    assert.equal(update.status, 200);
    const updated = (await update.json()).data;
    assert.equal(updated.name, "Updated Applicant");
    assert.equal(updated.phone, "555-0188");
    assert.equal(updated.city, "Nashik");
    assert.equal(updated.role, "INDIVIDUAL");
    assert.equal("password_hash" in updated, false);
    assert.equal((await request("/api/users/me", { method: "PUT", token: applicant.token, body: { name: "Spoof", role: "ADMIN" } })).status, 400);
    assert.equal((await request("/api/users/me", { method: "PUT", token: owner.token, body: { name: "Wrong role" } })).status, 403);
  });

  await t.test("NGO workspace lists only owned needs and responses with live aggregates", async () => {
    const ownedNeed = await createNeed(owner, { title: "NGO workspace owned need", type: "MATERIAL", quantity: 10 });
    const otherDraftResponse = await request("/api/needs", {
      method: "POST", token: otherNgo.token,
      body: {
        causeId, title: `${runId.slice(0, 8)} Other NGO private draft`, description: "Private ownership fixture.",
        contributionType: "VOLUNTEER", priority: "MEDIUM", deadline: null, status: "DRAFT",
      },
    });
    assert.equal(otherDraftResponse.status, 201);
    const otherNeed = (await otherDraftResponse.json()).data;
    createdNeedIds.push(otherNeed.need_id);
    const pendingResponse = await request(`/api/needs/${ownedNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token,
      body: { contributionType: "MATERIAL", quantity: 3, description: "Workspace response fixture" },
    });
    assert.equal(pendingResponse.status, 201);
    const contributionId = (await pendingResponse.json()).data.contribution_id;
    createdContributionIds.push(contributionId);

    const ownedList = await request("/api/ngos/me/needs?limit=100", { token: owner.token });
    assert.equal(ownedList.status, 200);
    const ownedPage = (await ownedList.json()).data;
    assert.ok(ownedPage.items.some((item) => item.need_id === ownedNeed.need_id));
    assert.ok(!ownedPage.items.some((item) => item.need_id === otherNeed.need_id));
    const aggregate = ownedPage.items.find((item) => item.need_id === ownedNeed.need_id);
    assert.equal(Number(aggregate.quantity_reserved), 0, "pending responses do not reserve material");
    assert.equal(Number(aggregate.quantity_available), 10);
    assert.equal((await request(`/api/ngos/me/needs/${ownedNeed.need_id}`, { token: owner.token })).status, 200);
    assert.equal((await request(`/api/ngos/me/needs/${ownedNeed.need_id}`, { token: otherNgo.token })).status, 404);
    assert.equal((await request(`/api/ngos/me/needs/${ownedNeed.need_id}`, { token: individual.token })).status, 403);
    assert.equal((await request("/api/ngos/me/needs")).status, 401);

    const responseList = await request(`/api/ngos/me/responses?needId=${ownedNeed.need_id}`, { token: owner.token });
    assert.equal(responseList.status, 200);
    const responsePage = (await responseList.json()).data;
    const response = responsePage.items.find((item) => item.response_id === contributionId);
    assert.equal(response.contribution_type, "MATERIAL");
    assert.equal(response.individual_name, "Integration contributor");
    assert.equal("individual_email" in response, false);
    assert.equal("individual_phone" in response, false);
    assert.equal((await request("/api/ngos/me/responses", { token: otherNgo.token })).status, 200);
    const otherRows = (await (await request(`/api/ngos/me/responses?needId=${ownedNeed.need_id}`, { token: otherNgo.token })).json()).data.items;
    assert.deepEqual(otherRows, []);
    const moneyFixture = await testPool.query(
      `INSERT INTO contributions (need_id, user_id, contribution_type, description, amount, status)
       VALUES ($1, $2, 'MONEY', 'Legacy historical record', 25, 'PENDING') RETURNING contribution_id`,
      [moneyNeed.need_id, contributor.userId]
    );
    createdContributionIds.push(moneyFixture.rows[0].contribution_id);
    const historicalMoney = await request(`/api/ngos/me/responses?needId=${moneyNeed.need_id}&contributionType=MONEY`, { token: owner.token });
    assert.equal(historicalMoney.status, 200);
    const historicalRow = (await historicalMoney.json()).data.items.find((item) => item.response_id === moneyFixture.rows[0].contribution_id);
    assert.equal(historicalRow.contribution_type, "MONEY");
    assert.equal(historicalRow.status, "PENDING");
    assert.equal("individual_email" in historicalRow, false);
    assert.equal((await request("/api/ngos/me/dashboard", { token: owner.token })).status, 200);
    assert.equal((await request("/api/ngos/me/dashboard", { token: individual.token })).status, 403);
    assert.equal((await request("/api/ngos/me/dashboard")).status, 401);
  });

  await t.test("Admin workspace APIs protect access, manage accounts and moderate needs safely", async () => {
    const dashboard = await request("/api/admin/dashboard", { token: adminToken });
    assert.equal(dashboard.status, 200);
    const dashboardData = (await dashboard.json()).data;
    assert.ok(Number.isInteger(dashboardData.total_individuals));
    assert.ok(Array.isArray(dashboardData.recentActivity));
    assert.equal((await request("/api/admin/dashboard", { token: individual.token })).status, 403);

    const userListResponse = await request("/api/admin/users?role=INDIVIDUAL&limit=5", { token: adminToken });
    assert.equal(userListResponse.status, 200);
    const userPage = (await userListResponse.json()).data;
    assert.ok(userPage.items.length <= 5);
    assert.equal("password_hash" in (userPage.items[0] || {}), false);
    const detailResponse = await request(`/api/admin/users/${applicant.userId}`, { token: adminToken });
    assert.equal(detailResponse.status, 200);
    const detail = (await detailResponse.json()).data;
    assert.equal(detail.email, applicant.email);
    assert.equal("password_hash" in detail, false);

    const selfSuspend = await request(`/api/admin/users/${adminUserId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: true, reason: "Self protection check" },
    });
    assert.equal(selfSuspend.status, 409);
    const suspend = await request(`/api/admin/users/${applicant.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: true, reason: "Integration account suspension check" },
    });
    assert.equal(suspend.status, 200);
    assert.equal((await request("/api/users/me", { token: applicant.token })).status, 401);
    const blockedLogin = await request("/api/auth/login", { method: "POST", body: { email: applicant.email, password } });
    assert.equal(blockedLogin.status, 403);
    assert.equal((await blockedLogin.json()).code, "ACCOUNT_SUSPENDED");
    const reactivate = await request(`/api/admin/users/${applicant.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: false, reason: "Integration account reactivation check" },
    });
    assert.equal(reactivate.status, 200);
    assert.equal((await request("/api/users/me", { token: applicant.token })).status, 200);
    const managedDetail = await request(`/api/admin/users/${applicant.userId}`, { token: adminToken });
    assert.ok((await managedDetail.json()).data.adminActions.length >= 2);

    const analytics = await request("/api/admin/analytics", { token: adminToken });
    assert.equal(analytics.status, 200);
    const report = (await analytics.json()).data;
    assert.ok(Array.isArray(report.registrations));
    assert.ok(Array.isArray(report.needs));
    assert.ok(Array.isArray(report.engagement));

    const need = await createNeed(owner, { title: "Admin moderation integration need", type: "VOLUNTEER" });
    const hidden = await request(`/api/admin/needs/${need.need_id}/moderation`, {
      method: "PATCH", token: adminToken, body: { hidden: true, reason: "Integration visibility check" },
    });
    assert.equal(hidden.status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}`)).status, 404);
    assert.equal((await request(`/api/needs/${need.need_id}/applications`, {
      method: "POST", token: applicant.token, body: { message: "Must not attach to hidden need" },
    })).status, 404);
    assert.equal((await request(`/api/ngos/me/needs/${need.need_id}`, { token: owner.token })).status, 200);
    const needDetail = await request(`/api/admin/needs/${need.need_id}`, { token: adminToken });
    const hiddenDetails = (await needDetail.json()).data;
    assert.equal(hiddenDetails.moderation_status, "HIDDEN");
    assert.equal(hiddenDetails.adminActions[0].reason, "Integration visibility check");
    const restored = await request(`/api/admin/needs/${need.need_id}/moderation`, {
      method: "PATCH", token: adminToken, body: { hidden: false, reason: "Integration restoration check" },
    });
    assert.equal(restored.status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}`)).status, 200);
    assert.equal((await request("/api/admin/needs", { token: individual.token })).status, 403);

    const suspendNgo = await request(`/api/admin/users/${owner.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: true, reason: "Integration NGO suspension visibility check" },
    });
    assert.equal(suspendNgo.status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}`)).status, 404);
    assert.equal((await request("/api/ngos/me/needs", { token: owner.token })).status, 401);
    const reactivateNgo = await request(`/api/admin/users/${owner.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: false, reason: "Integration NGO reactivation visibility check" },
    });
    assert.equal(reactivateNgo.status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}`)).status, 200);
  });

  await t.test("notifications are recipient-scoped, paginated, readable, and unavailable to suspended accounts", async () => {
    assert.equal((await request("/api/notifications")).status, 401);
    const firstPageResponse = await request("/api/notifications?limit=1&offset=0", { token: applicant.token });
    assert.equal(firstPageResponse.status, 200);
    const firstPage = (await firstPageResponse.json()).data;
    assert.equal(firstPage.items.length, 1);
    assert.ok(firstPage.pagination.total >= 3);
    assert.equal(firstPage.pagination.hasNext, true);
    assert.equal(
      firstPage.items[0].navigation_target,
      firstPage.items[0].event_type.startsWith("CONTRIBUTION_") ? "/individual/contributions" : "/individual/responses"
    );
    assert.equal("recipient_user_id" in firstPage.items[0], false);
    assert.equal("email" in firstPage.items[0], false);
    assert.equal("phone" in firstPage.items[0], false);

    const notificationId = firstPage.items[0].notification_id;
    assert.equal((await request(`/api/notifications/${notificationId}/read`, { method: "PATCH", token: matcher.token })).status, 404);
    const beforeCount = (await (await request("/api/notifications/unread-count", { token: applicant.token })).json()).data.unreadCount;
    const read = await request(`/api/notifications/${notificationId}/read`, { method: "PATCH", token: applicant.token });
    assert.equal(read.status, 200);
    assert.ok((await read.json()).data.read_at);
    assert.equal((await request(`/api/notifications/${notificationId}/read`, { method: "PATCH", token: applicant.token })).status, 200);
    const afterCount = (await (await request("/api/notifications/unread-count", { token: applicant.token })).json()).data.unreadCount;
    assert.equal(afterCount, beforeCount - 1);

    const unreadOnly = await request("/api/notifications?unreadOnly=true", { token: applicant.token });
    assert.equal(unreadOnly.status, 200);
    assert.ok((await unreadOnly.json()).data.items.every((item) => item.read_at === null));
    assert.equal((await request("/api/notifications?unreadOnly=perhaps", { token: applicant.token })).status, 400);
    assert.equal((await request("/api/notifications?limit=101", { token: applicant.token })).status, 400);
    assert.equal((await request("/api/notifications/not-a-uuid/read", { method: "PATCH", token: applicant.token })).status, 400);

    const markAll = await request("/api/notifications/read-all", { method: "PATCH", token: applicant.token });
    assert.equal(markAll.status, 200);
    assert.ok((await markAll.json()).data.updatedCount >= 1);
    assert.equal((await (await request("/api/notifications/unread-count", { token: applicant.token })).json()).data.unreadCount, 0);
    const emptyUnread = await request("/api/notifications?unreadOnly=true", { token: applicant.token });
    assert.deepEqual((await emptyUnread.json()).data.items, []);

    const adminNotifications = await request("/api/notifications?limit=100", { token: adminToken });
    assert.ok((await adminNotifications.json()).data.items.some((item) => item.event_type === "NGO_VERIFICATION_SUBMITTED" && item.navigation_target === "/admin/ngos/pending"));

    const suspended = await request(`/api/admin/users/${matcher.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: true, reason: "Integration notification authorization check" },
    });
    assert.equal(suspended.status, 200);
    assert.equal((await request("/api/notifications", { token: matcher.token })).status, 401);
    const reactivated = await request(`/api/admin/users/${matcher.userId}/status`, {
      method: "PATCH", token: adminToken, body: { suspended: false, reason: "Integration notification test cleanup" },
    });
    assert.equal(reactivated.status, 200);

    const duplicates = await testPool.query(
      "SELECT COUNT(*)::int AS duplicate_groups FROM (SELECT event_key FROM notifications GROUP BY event_key HAVING COUNT(*) > 1) d"
    );
    assert.equal(duplicates.rows[0].duplicate_groups, 0);
  });

  await t.test("need closure cancels pending records and preserves accepted engagements and contact access", async () => {
    const need = await createNeed(owner, { title: "Lifecycle closure fixture", type: "VOLUNTEER" });
    const pendingResponse = await request(`/api/needs/${need.need_id}/applications`, {
      method: "POST", token: applicant.token, body: { message: "Pending at closure" },
    });
    const pendingId = (await pendingResponse.json()).data.application_id;
    createdApplicationIds.push(pendingId);
    const acceptedResponse = await request(`/api/needs/${need.need_id}/applications`, {
      method: "POST", token: contributor.token, body: { message: "Accepted at closure" },
    });
    const acceptedId = (await acceptedResponse.json()).data.application_id;
    createdApplicationIds.push(acceptedId);
    assert.equal((await request(`/api/needs/${need.need_id}/applications/${acceptedId}`, {
      method: "PUT", token: owner.token, body: { status: "ACCEPTED" },
    })).status, 200);
    const rejectedResponse = await request(`/api/needs/${need.need_id}/applications`, {
      method: "POST", token: matcher.token, body: { message: "Will not participate" },
    });
    const rejectedId = (await rejectedResponse.json()).data.application_id;
    createdApplicationIds.push(rejectedId);
    assert.equal((await request(`/api/needs/${need.need_id}/applications/${rejectedId}`, {
      method: "PUT", token: owner.token, body: { status: "REJECTED" },
    })).status, 200);
    const completedResponse = await request(`/api/needs/${need.need_id}/applications`, {
      method: "POST", token: individual.token, body: { message: "Completed before closure" },
    });
    const completedId = (await completedResponse.json()).data.application_id;
    createdApplicationIds.push(completedId);
    assert.equal((await request(`/api/needs/${need.need_id}/applications/${completedId}`, {
      method: "PUT", token: owner.token, body: { status: "ACCEPTED" },
    })).status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}/applications/${completedId}`, {
      method: "PUT", token: owner.token, body: { status: "COMPLETED" },
    })).status, 200);

    assert.equal((await request(`/api/ngos/me/needs/${need.need_id}/close`, { method: "POST", token: otherNgo.token })).status, 404);
    const closedResponse = await request(`/api/ngos/me/needs/${need.need_id}/close`, { method: "POST", token: owner.token });
    assert.equal(closedResponse.status, 200);
    const closed = (await closedResponse.json()).data;
    assert.equal(closed.need.status, "CLOSED");
    assert.equal(closed.canceledEngagements.applications, 1);
    assert.equal(closed.preservedEngagements.accepted_applications, 1);
    const records = await testPool.query(
      "SELECT application_id, status, resolution_reason FROM volunteer_applications WHERE application_id = ANY($1::uuid[])",
      [[pendingId, acceptedId, rejectedId, completedId]],
    );
    assert.equal(records.rows.find((row) => row.application_id === pendingId).status, "REJECTED");
    assert.match(records.rows.find((row) => row.application_id === pendingId).resolution_reason, /Need closed/);
    assert.equal(records.rows.find((row) => row.application_id === acceptedId).status, "ACCEPTED");
    assert.equal(records.rows.find((row) => row.application_id === rejectedId).status, "REJECTED");
    assert.equal(records.rows.find((row) => row.application_id === completedId).status, "COMPLETED");
    assert.equal((await request(`/api/engagements/applications/${acceptedId}/contact`, { token: contributor.token })).status, 200);
    assert.equal((await request(`/api/needs/${need.need_id}/applications`, { method: "POST", token: matcher.token, body: {} })).status, 404);
    const history = await testPool.query("SELECT event_type, to_status FROM need_lifecycle_history WHERE need_id = $1 ORDER BY created_at", [need.need_id]);
    assert.deepEqual(history.rows.map((row) => row.event_type), ["CREATED", "CLOSED"]);
    const closeNotices = await testPool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE event_key LIKE $1", [`%need-lifecycle:closed:${need.need_id}%`]);
    assert.ok(closeNotices.rows[0].count >= 2);

    const materialNeed = await createNeed(owner, { title: "Lifecycle material reservation fixture", type: "MATERIAL", quantity: 4 });
    const postContribution = (account) => request(`/api/needs/${materialNeed.need_id}/contributions`, {
      method: "POST", token: account.token, body: { contributionType: "MATERIAL", quantity: 2, description: "Reserved boxes" },
    });
    const pendingContributionResponse = await postContribution(applicant);
    const pendingContributionId = (await pendingContributionResponse.json()).data.contribution_id;
    createdContributionIds.push(pendingContributionId);
    const acceptedContributionResponse = await postContribution(contributor);
    const acceptedContributionId = (await acceptedContributionResponse.json()).data.contribution_id;
    createdContributionIds.push(acceptedContributionId);
    assert.equal((await request(`/api/needs/${materialNeed.need_id}/contributions/${acceptedContributionId}/status`, {
      method: "PUT", token: owner.token, body: { status: "ACCEPTED" },
    })).status, 200);
    assert.equal((await request(`/api/needs/${materialNeed.need_id}/contributions/${acceptedContributionId}/status`, {
      method: "PUT", token: owner.token, body: { status: "IN_PROGRESS" },
    })).status, 200);
    const closeMaterial = await request(`/api/ngos/me/needs/${materialNeed.need_id}/close`, { method: "POST", token: owner.token });
    assert.equal(closeMaterial.status, 200);
    const afterCloseMaterial = await request(`/api/ngos/me/needs/${materialNeed.need_id}`, { token: owner.token });
    const closedMaterialNeed = (await afterCloseMaterial.json()).data;
    assert.equal(closedMaterialNeed.status, "CLOSED");
    assert.equal(Number(closedMaterialNeed.quantity_reserved), 2);
    const pendingMaterialRow = await testPool.query("SELECT status, resolution_reason FROM contributions WHERE contribution_id = $1", [pendingContributionId]);
    assert.equal(pendingMaterialRow.rows[0].status, "REJECTED");
    assert.match(pendingMaterialRow.rows[0].resolution_reason, /Need closed/);
    assert.equal((await request(`/api/ngos/me/responses?needId=${materialNeed.need_id}`, { token: owner.token })).status, 200);
    const finishAccepted = await request(`/api/needs/${materialNeed.need_id}/contributions/${acceptedContributionId}/status`, {
      method: "PUT", token: owner.token, body: { status: "COMPLETED" },
    });
    assert.equal(finishAccepted.status, 200);
    const afterFinishMaterial = await request(`/api/ngos/me/needs/${materialNeed.need_id}`, { token: owner.token });
    assert.equal(Number((await afterFinishMaterial.json()).data.quantity_reserved), 0);
    const finalNeed = await testPool.query("SELECT status, quantity_fulfilled, completed_at, closed_at FROM needs WHERE need_id = $1", [materialNeed.need_id]);
    assert.equal(finalNeed.rows[0].status, "CLOSED");
    assert.equal(finalNeed.rows[0].quantity_fulfilled, 2);
    assert.equal(finalNeed.rows[0].completed_at, null);
    assert.ok(finalNeed.rows[0].closed_at);
  });

  await t.test("expiry is idempotent and blocks submissions at the deadline boundary", async () => {
    const need = await createNeed(owner, { title: "Lifecycle expiry fixture", type: "VOLUNTEER", deadline: new Date(Date.now() + 60000).toISOString() });
    await testPool.query("UPDATE needs SET deadline = clock_timestamp() - INTERVAL '1 second' WHERE need_id = $1", [need.need_id]);
    const beforeRead = await testPool.query("SELECT status, expired_at FROM needs WHERE need_id = $1", [need.need_id]);
    assert.equal(beforeRead.rows[0].status, "ACTIVE");
    assert.equal(beforeRead.rows[0].expired_at, null);
    assert.equal((await request("/api/admin/analytics", { token: adminToken })).status, 200);
    assert.equal((await request("/api/admin/dashboard", { token: adminToken })).status, 200);
    assert.equal((await request("/api/admin/needs?limit=100", { token: adminToken })).status, 200);
    assert.equal((await request("/api/needs?limit=100")).status, 200);
    assert.equal((await request("/api/ngos/me/needs?limit=100&offset=0", { token: owner.token })).status, 200);
    assert.equal((await request("/api/ngos/me/dashboard", { token: owner.token })).status, 200);
    const afterRead = await testPool.query("SELECT status, expired_at FROM needs WHERE need_id = $1", [need.need_id]);
    assert.equal(afterRead.rows[0].status, "ACTIVE");
    assert.equal(afterRead.rows[0].expired_at, null);

    await Promise.all([needExpirationWorker.runExpirationSweep(), needLifecycleRepository.expireDueNeeds()]);
    const expired = await testPool.query("SELECT status, expired_at FROM needs WHERE need_id = $1", [need.need_id]);
    assert.equal(expired.rows[0].status, "EXPIRED");
    assert.ok(expired.rows[0].expired_at);
    const events = await testPool.query("SELECT COUNT(*)::int AS count FROM need_lifecycle_history WHERE need_id = $1 AND event_type = 'EXPIRED'", [need.need_id]);
    assert.equal(events.rows[0].count, 1);
    const expiryNotices = await testPool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE event_type = 'NEED_EXPIRED' AND related_entity_type = 'NEED' AND related_entity_id = $1", [need.need_id]);
    assert.equal(expiryNotices.rows[0].count, 1);
    await needLifecycleRepository.expireDueNeeds();
    const repeatedEvents = await testPool.query("SELECT COUNT(*)::int AS count FROM need_lifecycle_history WHERE need_id = $1 AND event_type = 'EXPIRED'", [need.need_id]);
    const repeatedNotices = await testPool.query("SELECT COUNT(*)::int AS count FROM notifications WHERE event_type = 'NEED_EXPIRED' AND related_entity_type = 'NEED' AND related_entity_id = $1", [need.need_id]);
    assert.equal(repeatedEvents.rows[0].count, 1);
    assert.equal(repeatedNotices.rows[0].count, 1);
    assert.equal((await request(`/api/needs/${need.need_id}/applications`, { method: "POST", token: applicant.token, body: {} })).status, 404);

    const notYetSweptVolunteer = await createNeed(owner, { title: "Write guard volunteer expiry", type: "VOLUNTEER", deadline: new Date(Date.now() + 60000).toISOString() });
    await testPool.query("UPDATE needs SET deadline = clock_timestamp() - INTERVAL '1 second' WHERE need_id = $1", [notYetSweptVolunteer.need_id]);
    assert.equal((await request(`/api/needs/${notYetSweptVolunteer.need_id}/applications`, { method: "POST", token: applicant.token, body: {} })).status, 404);
    const guardedVolunteer = await testPool.query("SELECT status FROM needs WHERE need_id = $1", [notYetSweptVolunteer.need_id]);
    assert.equal(guardedVolunteer.rows[0].status, "EXPIRED");

    const notYetSweptMaterial = await createNeed(owner, { title: "Write guard material expiry", type: "MATERIAL", quantity: 2, deadline: new Date(Date.now() + 60000).toISOString() });
    await testPool.query("UPDATE needs SET deadline = clock_timestamp() - INTERVAL '1 second' WHERE need_id = $1", [notYetSweptMaterial.need_id]);
    assert.equal((await request(`/api/needs/${notYetSweptMaterial.need_id}/contributions`, {
      method: "POST", token: contributor.token,
      body: { contributionType: "MATERIAL", quantity: 1, description: "Must not be accepted after its deadline." },
    })).status, 404);
    const guardedMaterial = await testPool.query("SELECT status FROM needs WHERE need_id = $1", [notYetSweptMaterial.need_id]);
    assert.equal(guardedMaterial.rows[0].status, "EXPIRED");

    const committedNeed = await createNeed(owner, { title: "Expired material commitment fixture", type: "MATERIAL", quantity: 2, deadline: new Date(Date.now() + 60000).toISOString() });
    const committedResponse = await request(`/api/needs/${committedNeed.need_id}/contributions`, {
      method: "POST", token: contributor.token, body: { contributionType: "MATERIAL", quantity: 2, description: "Already accepted" },
    });
    const committedId = (await committedResponse.json()).data.contribution_id;
    createdContributionIds.push(committedId);
    assert.equal((await request(`/api/needs/${committedNeed.need_id}/contributions/${committedId}/status`, { method: "PUT", token: owner.token, body: { status: "ACCEPTED" } })).status, 200);
    assert.equal((await request(`/api/needs/${committedNeed.need_id}/contributions/${committedId}/status`, { method: "PUT", token: owner.token, body: { status: "IN_PROGRESS" } })).status, 200);
    await testPool.query("UPDATE needs SET deadline = clock_timestamp() WHERE need_id = $1", [committedNeed.need_id]);
    await request("/api/ngos/me/needs?limit=100&offset=0", { token: owner.token });
    const finishAfterExpiry = await request(`/api/needs/${committedNeed.need_id}/contributions/${committedId}/status`, {
      method: "PUT", token: owner.token, body: { status: "COMPLETED" },
    });
    assert.equal(finishAfterExpiry.status, 200);
    const finished = await testPool.query("SELECT status, expired_at, completed_at FROM needs WHERE need_id = $1", [committedNeed.need_id]);
    assert.equal(finished.rows[0].status, "COMPLETED");
    assert.ok(finished.rows[0].expired_at);
    assert.ok(finished.rows[0].completed_at);
  });
});

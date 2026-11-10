const { afterEach, test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { validationResult } = require("express-validator");

const pool = require("../src/config/database");
const repository = require("../src/repositories/notification.repository");
const service = require("../src/services/notification.service");
const events = require("../src/repositories/notificationEvents.repository");
const { listNotificationsValidator, notificationIdValidator } = require("../src/validators/notification.validator");

const recipientId = "10000000-0000-4000-8000-000000000001";
const notificationId = "70000000-0000-4000-8000-000000000001";
const relatedId = "60000000-0000-4000-8000-000000000001";
const originalQuery = pool.query;

afterEach(() => { pool.query = originalQuery; });

test("notification listing is recipient-scoped, parameterized, unread-filterable, and total-aware", async () => {
  let sql;
  let values;
  pool.query = async (query, parameters) => {
    sql = query;
    values = parameters;
    return { rows: [{ notification_id: notificationId, total_count: 4, event_type: "APPLICATION_ACCEPTED" }] };
  };
  const result = await repository.listForUser(recipientId, { limit: 2, offset: 2, unreadOnly: true });
  assert.equal(result.total, 4);
  assert.equal(result.items.length, 1);
  assert.deepEqual(values, [recipientId, true, 2, 2]);
  assert.match(sql, /recipient_user_id = \$1/);
  assert.match(sql, /read_at IS NULL/);
  assert.match(sql, /LIMIT \$3 OFFSET \$4/);
});

test("mark read and mark all are scoped to the JWT recipient", async () => {
  const calls = [];
  pool.query = async (sql, values) => {
    calls.push({ sql, values });
    return { rows: [{ notification_id: notificationId, read_at: "2026-01-01T00:00:00Z" }], rowCount: 1 };
  };
  await repository.markReadForUser(notificationId, recipientId);
  await repository.markAllReadForUser(recipientId);
  assert.deepEqual(calls[0].values, [notificationId, recipientId]);
  assert.match(calls[0].sql, /WHERE notification_id = \$1 AND recipient_user_id = \$2/);
  assert.deepEqual(calls[1].values, [recipientId]);
  assert.match(calls[1].sql, /WHERE recipient_user_id = \$1 AND read_at IS NULL/);
});

test("notification service maps events only to internal workflow destinations", async () => {
  assert.equal(service.navigationTargetFor("APPLICATION_RECEIVED", "NGO"), "/ngo/responses");
  assert.equal(service.navigationTargetFor("APPLICATION_ACCEPTED", "INDIVIDUAL"), "/individual/responses");
  assert.equal(service.navigationTargetFor("APPLICATION_REJECTED", "NGO"), "/ngo/responses");
  assert.equal(service.navigationTargetFor("CONTRIBUTION_COMPLETED", "INDIVIDUAL"), "/individual/contributions");
  assert.equal(service.navigationTargetFor("NGO_VERIFICATION_SUBMITTED", "ADMIN"), "/admin/ngos/pending");
  assert.equal(service.navigationTargetFor("NGO_VERIFICATION_APPROVED", "NGO"), "/ngo/verification");
  assert.equal(service.navigationTargetFor("NEED_CLOSED", "NGO", "NEED", "need-123"), "/ngo/needs/need-123");
  assert.equal(service.navigationTargetFor("NEED_EXPIRED", "INDIVIDUAL", "APPLICATION", "application-123"), "/individual/responses");
  assert.equal(service.navigationTargetFor("APPLICATION_RECEIVED", "INDIVIDUAL"), null);
  assert.equal(service.navigationTargetFor("NGO_VERIFICATION_APPROVED", "ADMIN"), null);
});

test("notification lookup hides unowned and missing IDs behind the same 404", async () => {
  pool.query = async () => ({ rows: [] });
  await assert.rejects(service.markRead(notificationId, recipientId, "INDIVIDUAL"), (error) => error.statusCode === 404);
});

test("notification validators constrain UUIDs, pagination, and unread filters", async () => {
  const run = async (validators, req) => {
    for (const validator of validators) {
      await new Promise((resolve, reject) => validator(req, {}, (error) => error ? reject(error) : resolve()));
    }
    return validationResult(req).array();
  };
  assert.equal((await run(listNotificationsValidator, { query: { limit: "20", offset: "0", unreadOnly: "true" }, params: {} })).length, 0);
  assert.ok((await run(listNotificationsValidator, { query: { limit: "101", unreadOnly: "yes" }, params: {} })).length > 0);
  assert.equal((await run(notificationIdValidator, { query: {}, params: { notificationId } })).length, 0);
  assert.ok((await run(notificationIdValidator, { query: {}, params: { notificationId: "bad" } })).length > 0);
});

test("business event insertions use stable unique keys and never include contact details", async () => {
  const calls = [];
  const executor = { query: async (sql, values) => {
    if (/SELECT g\.user_id FROM needs/.test(sql)) return { rows: [] };
    calls.push({ sql, values });
    return { rowCount: 1 };
  } };
  await events.createApplicationStatus(executor, {
    application_id: relatedId, user_id: recipientId, status: "REJECTED", need_title: "Community cleanup",
  });
  await events.createContributionStatus(executor, {
    contribution_id: notificationId, user_id: recipientId, status: "COMPLETED", need_title: "Community cleanup",
  });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(({ sql }) => /ON CONFLICT \(event_key\) DO NOTHING/.test(sql)));
  assert.equal(calls[0].values[1], "APPLICATION_REJECTED");
  assert.match(calls[0].values[6], /application:rejected/);
  assert.equal(calls[1].values[1], "CONTRIBUTION_COMPLETED");
  assert.doesNotMatch(calls.flatMap(({ values }) => values).join(" "), /@|phone|password|token/i);
  assert.doesNotMatch(calls.map(({ sql }) => sql).join(" "), /email|phone|password_hash/i);
});

test("verification notification creation includes the submitter and active admins only", async () => {
  const calls = [];
  const executor = { query: async (sql, values) => {
    calls.push({ sql, values });
    if (/SELECT user_id FROM users WHERE role = 'ADMIN'/.test(sql)) return { rows: [{ user_id: "10000000-0000-4000-8000-000000000002" }] };
    return { rowCount: 1 };
  } };
  await events.createVerificationSubmitted(executor, { ngoUserId: recipientId, submissionId: relatedId });
  assert.equal(calls.length, 3);
  const inserts = calls.filter(({ sql }) => /INSERT INTO notifications/.test(sql));
  const adminLookup = calls.find(({ sql }) => /SELECT user_id FROM users WHERE role = 'ADMIN'/.test(sql));
  assert.deepEqual(inserts.map(({ values }) => values[1]), ["NGO_VERIFICATION_SUBMITTED", "NGO_VERIFICATION_SUBMITTED"]);
  assert.match(adminLookup.sql, /is_suspended = FALSE/);
  assert.ok(inserts[0].values[6] !== inserts[1].values[6]);
});

test("migration 005 grants only required notification privileges and rollback drops the table", () => {
  const migrations = path.resolve(__dirname, "../../database/migrations");
  const up = fs.readFileSync(path.join(migrations, "005_in_app_notifications.sql"), "utf8");
  const down = fs.readFileSync(path.join(migrations, "005_in_app_notifications.down.sql"), "utf8");
  assert.match(up.trimStart(), /^BEGIN;/);
  assert.match(up.trimEnd(), /COMMIT;$/);
  assert.match(up, /REVOKE ALL PRIVILEGES ON TABLE public\.notifications FROM ngo_connect_runtime, PUBLIC;/);
  assert.match(up, /GRANT SELECT, INSERT ON TABLE public\.notifications TO ngo_connect_runtime;/);
  assert.match(up, /GRANT UPDATE \(read_at\) ON TABLE public\.notifications TO ngo_connect_runtime;/);
  assert.match(down.trimStart(), /^BEGIN;/);
  assert.match(down, /DROP TABLE public\.notifications;/);
});

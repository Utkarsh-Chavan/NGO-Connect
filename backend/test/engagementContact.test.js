const { test } = require("node:test");
const assert = require("node:assert/strict");

const repository = require("../src/repositories/engagementContact.repository");
const service = require("../src/services/engagementContact.service");
const routes = require("../src/routes/engagementContact.routes");
const authenticate = require("../src/middleware/auth.middleware");

const individualId = "10000000-0000-4000-8000-000000000001";
const ngoUserId = "10000000-0000-4000-8000-000000000002";
const context = (status = "ACCEPTED") => ({
  status,
  contribution_type: "SKILL",
  individual_user_id: individualId,
  individual_name: "Volunteer",
  individual_email: "private.volunteer@example.test",
  individual_phone: "555-0101",
  ngo_user_id: ngoUserId,
  ngo_name: "Community NGO",
  ngo_email: "contact@ngo.example.test",
  ngo_phone: "555-0202",
});

test("accepted application contact is disclosed only to its participants", async () => {
  const original = repository.findApplicationContactContext;
  repository.findApplicationContactContext = async () => context();
  try {
    assert.deepEqual(await service.getApplicationContact({
      userId: individualId, role: "INDIVIDUAL", applicationId: "a",
    }), { name: "Community NGO", email: "contact@ngo.example.test", phone: "555-0202" });
    assert.deepEqual(await service.getApplicationContact({
      userId: ngoUserId, role: "NGO", applicationId: "a",
    }), { name: "Volunteer", email: "private.volunteer@example.test", phone: "555-0101" });
    await assert.rejects(
      service.getApplicationContact({ userId: "10000000-0000-4000-8000-000000000099", role: "INDIVIDUAL", applicationId: "a" }),
      (error) => error.statusCode === 404
    );
    await assert.rejects(
      service.getApplicationContact({ userId: individualId, role: "ADMIN", applicationId: "a" }),
      (error) => error.statusCode === 404
    );
  } finally {
    repository.findApplicationContactContext = original;
  }
});

test("pending and rejected engagement statuses never disclose contact", async () => {
  const original = repository.findContributionContactContext;
  try {
    for (const status of ["PENDING", "REJECTED"]) {
      repository.findContributionContactContext = async () => context(status);
      await assert.rejects(
        service.getContributionContact({ userId: individualId, role: "INDIVIDUAL", contributionId: "c" }),
        (error) => error.statusCode === 403
      );
    }
  } finally {
    repository.findContributionContactContext = original;
  }
});

test("legacy MONEY records never disclose contact through an engagement endpoint", async () => {
  const original = repository.findContributionContactContext;
  repository.findContributionContactContext = async () => ({ ...context("ACCEPTED"), contribution_type: "MONEY" });
  try {
    await assert.rejects(
      service.getContributionContact({ userId: individualId, role: "INDIVIDUAL", contributionId: "c" }),
      (error) => error.statusCode === 404
    );
  } finally {
    repository.findContributionContactContext = original;
  }
});

test("contact routes require authentication and restrict roles to participants", () => {
  for (const path of ["/applications/:applicationId/contact", "/contributions/:contributionId/contact"]) {
    const route = routes.stack.find((layer) => layer.route?.path === path)?.route;
    assert.ok(route);
    assert.equal(route.stack[0].handle, authenticate);
    const roleMiddleware = route.stack[1].handle;
    let continued = false;
    const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json() {} };
    roleMiddleware({ user: { role: "ADMIN" } }, response, () => { continued = true; });
    assert.equal(response.statusCode, 403);
    assert.equal(continued, false);
  }
});

test("contact repository scopes reads by an opaque engagement id and joins the owning parties", async () => {
  const pool = require("../src/config/database");
  const original = pool.query;
  let sql;
  let values;
  pool.query = async (query, params) => { sql = query; values = params; return { rows: [] }; };
  try {
    await repository.findApplicationContactContext("application-id");
    assert.deepEqual(values, ["application-id"]);
    assert.match(sql, /WHERE va\.application_id = \$1/);
    assert.match(sql, /JOIN users applicant/);
  } finally {
    pool.query = original;
  }
});

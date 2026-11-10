const { test } = require("node:test");
const assert = require("node:assert/strict");

const pool = require("../src/config/database");
const ngoRepository = require("../src/repositories/ngo.repository");

test("new NGO profile creation starts NOT_SUBMITTED without creating a submission", async () => {
  const originalQuery = pool.query;
  let query;
  let values;
  pool.query = async (sql, parameters) => {
    query = sql;
    values = parameters;
    return {
      rows: [{
        ngo_id: "40000000-0000-4000-8000-000000000001",
        user_id: "40000000-0000-4000-8000-000000000002",
        name: "Community Aid",
        description: "Local support",
        email: "aid@example.test",
        phone: "555-0100",
        address: "1 Test Street",
        city: "Pune",
        verification_status: "NOT_SUBMITTED",
      }],
    };
  };

  try {
    const profile = await ngoRepository.createNgo({
      userId: "40000000-0000-4000-8000-000000000002",
      name: "Community Aid",
      description: "Local support",
      email: "aid@example.test",
      phone: "555-0100",
      address: "1 Test Street",
      city: "Pune",
      websiteUrl: null,
    });

    assert.match(query, /INSERT INTO ngos/);
    assert.match(query, /'NOT_SUBMITTED'/);
    assert.doesNotMatch(query, /ngo_verification_submissions/);
    assert.deepEqual(values, [
      "40000000-0000-4000-8000-000000000002",
      "Community Aid",
      "Local support",
      "aid@example.test",
      "555-0100",
      "1 Test Street",
      "Pune",
      null,
    ]);
    assert.equal(profile.verification_status, "NOT_SUBMITTED");
    assert.equal(profile.address, "1 Test Street");
  } finally {
    pool.query = originalQuery;
  }
});

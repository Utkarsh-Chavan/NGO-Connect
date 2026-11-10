const { test } = require("node:test");
const assert = require("node:assert/strict");

const errorHandler = require("../src/middleware/error.middleware");

const invokeErrorHandler = (error) => {
  let statusCode;
  let body;
  const res = {
    status(code) {
      statusCode = code;
      return this;
    },
    json(value) {
      body = value;
      return this;
    },
  };

  errorHandler(error, { method: "GET", originalUrl: "/api/test", url: "/api/test" }, res, () => {});
  return { statusCode, body };
};

test("central error handler preserves expected client error statuses", () => {
  const result = invokeErrorHandler(Object.assign(new Error("Invalid input"), { status: 400 }));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { success: false, message: "Invalid input" });
});

test("central error handler returns explicitly assigned public error codes", () => {
  const result = invokeErrorHandler(Object.assign(new Error("Verify your email"), {
    statusCode: 403,
    publicCode: "EMAIL_NOT_VERIFIED",
  }));
  assert.equal(result.statusCode, 403);
  assert.deepEqual(result.body, {
    success: false,
    message: "Verify your email",
    code: "EMAIL_NOT_VERIFIED",
  });
});

test("central error handler sanitizes JSON parser errors", () => {
  const result = invokeErrorHandler(Object.assign(new SyntaxError("parser detail with submitted bytes"), {
    status: 400,
    type: "entity.parse.failed",
  }));
  assert.equal(result.statusCode, 400);
  assert.deepEqual(result.body, { success: false, message: "Invalid JSON request body" });
});

test("central error handler hides internal error messages from clients", () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = invokeErrorHandler(new Error("sensitive database detail"));
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.body, { success: false, message: "Internal server error" });
  } finally {
    console.error = originalConsoleError;
  }
});

test("central error handler rejects invalid error status values", () => {
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    const result = invokeErrorHandler(Object.assign(new Error("bad status"), { statusCode: 200 }));
    assert.equal(result.statusCode, 500);
    assert.deepEqual(result.body, { success: false, message: "Internal server error" });
  } finally {
    console.error = originalConsoleError;
  }
});

const { afterEach, beforeEach, test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "ngo-connect-email-verification-test-secret";

const authService = require("../src/services/auth.service");
const emailVerificationService = require("../src/services/emailVerification.service");
const emailDeliveryService = require("../src/services/emailDelivery.service");
const transactionRepository = require("../src/repositories/transaction.repository");
const emailVerificationRepository = require("../src/repositories/emailVerification.repository");
const userRepository = require("../src/repositories/user.repository");

const originalMethods = {
  withTransaction: transactionRepository.withTransaction,
  findUserByEmail: userRepository.findUserByEmail,
  createUser: userRepository.createUser,
  lockVerificationAccountByEmail: userRepository.lockVerificationAccountByEmail,
  lockUserById: userRepository.lockUserById,
  markEmailVerified: userRepository.markEmailVerified,
  insertToken: emailVerificationRepository.insertToken,
  findTokenOwner: emailVerificationRepository.findTokenOwner,
  consumeToken: emailVerificationRepository.consumeToken,
  invalidateOutstandingTokens: emailVerificationRepository.invalidateOutstandingTokens,
  getIssueStats: emailVerificationRepository.getIssueStats,
};

let users;
let tokens;
let sentEmails;
let idCounter;
const originalNodeEnv = process.env.NODE_ENV;

const hashEquals = (left, right) => Buffer.from(left).equals(Buffer.from(right));

beforeEach(() => {
  process.env.NODE_ENV = "test";
  users = new Map();
  tokens = [];
  sentEmails = [];
  idCounter = 1;
  process.env.EMAIL_VERIFICATION_URL = "https://frontend.example.test/verify-email";
  process.env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS = "86400";

  transactionRepository.withTransaction = async (callback) => callback({ testClient: true });

  userRepository.findUserByEmail = async (email) =>
    [...users.values()].find((user) => user.email === email) || null;
  userRepository.createUser = async (input) => {
    if ([...users.values()].some((user) => user.email === input.email)) {
      const error = new Error("duplicate email");
      error.code = "23505";
      throw error;
    }
    const user = {
      user_id: input.userId,
      name: input.name,
      email: input.email,
      password_hash: input.passwordHash,
      role: input.role,
      email_verified: false,
      email_verified_at: null,
      phone: input.phone ?? null,
      city: input.city ?? null,
      availability: input.availability ?? null,
    };
    users.set(user.user_id, user);
    return user;
  };
  userRepository.lockVerificationAccountByEmail = async (_client, email) =>
    [...users.values()].find((user) => user.email === email) || null;
  userRepository.lockUserById = async (_client, userId) => users.get(userId) || null;
  userRepository.markEmailVerified = async (_client, userId) => {
    const user = users.get(userId);
    if (!user) return null;
    user.email_verified = true;
    user.email_verified_at = user.email_verified_at || new Date();
    return { user_id: userId };
  };

  emailVerificationRepository.insertToken = async (_client, input) => {
    const token = {
      token_id: `token-${idCounter++}`,
      user_id: input.userId,
      token_hash: Buffer.from(input.tokenHash),
      expires_at: new Date(Date.now() + input.ttlSeconds * 1000),
      created_at: new Date(),
      consumed_at: null,
      invalidated_at: null,
    };
    tokens.push(token);
    return { token_id: token.token_id, expires_at: token.expires_at };
  };
  emailVerificationRepository.findTokenOwner = async (_client, tokenHash) => {
    const token = tokens.find((item) => hashEquals(item.token_hash, tokenHash));
    return token ? {
      token_id: token.token_id,
      user_id: token.user_id,
      expires_at: token.expires_at,
      consumed_at: token.consumed_at,
      invalidated_at: token.invalidated_at,
    } : null;
  };
  emailVerificationRepository.consumeToken = async (_client, tokenHash) => {
    const token = tokens.find((item) => hashEquals(item.token_hash, tokenHash));
    if (!token || token.consumed_at || token.invalidated_at || token.expires_at <= new Date()) return null;
    token.consumed_at = new Date();
    return { token_id: token.token_id, user_id: token.user_id };
  };
  emailVerificationRepository.invalidateOutstandingTokens = async (_client, userId, exceptTokenId = null) => {
    for (const token of tokens) {
      if (token.user_id === userId && token.token_id !== exceptTokenId
          && !token.consumed_at && !token.invalidated_at) {
        token.invalidated_at = new Date();
      }
    }
  };
  emailVerificationRepository.getIssueStats = async (_client, userId) => {
    const issued = tokens.filter((token) => token.user_id === userId);
    const lastDay = issued.filter((token) => Date.now() - token.created_at.getTime() < 86400000);
    return {
      issued_in_24_hours: lastDay.length,
      latest_issue_at: issued.length ? issued.reduce((latest, token) =>
        token.created_at > latest ? token.created_at : latest, issued[0].created_at) : null,
    };
  };

  emailDeliveryService.setEmailDeliveryAdapter({
    async sendVerificationEmail(message) { sentEmails.push(message); },
  });
});

afterEach(() => {
  Object.assign(transactionRepository, { withTransaction: originalMethods.withTransaction });
  Object.assign(userRepository, {
    findUserByEmail: originalMethods.findUserByEmail,
    createUser: originalMethods.createUser,
    lockVerificationAccountByEmail: originalMethods.lockVerificationAccountByEmail,
    lockUserById: originalMethods.lockUserById,
    markEmailVerified: originalMethods.markEmailVerified,
  });
  Object.assign(emailVerificationRepository, {
    insertToken: originalMethods.insertToken,
    findTokenOwner: originalMethods.findTokenOwner,
    consumeToken: originalMethods.consumeToken,
    invalidateOutstandingTokens: originalMethods.invalidateOutstandingTokens,
    getIssueStats: originalMethods.getIssueStats,
  });
  emailDeliveryService.setEmailDeliveryAdapter(null);
  delete process.env.EMAIL_VERIFICATION_URL;
  delete process.env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS;
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});

const register = (email = "person@example.test") => authService.registerUser({
  name: "Test Person",
  email,
  password: "correct horse battery staple",
  role: "INDIVIDUAL",
});

const tokenFromEmail = (message = sentEmails[0]) =>
  new URLSearchParams(new URL(message.verificationUrl).hash.slice(1)).get("token");

test("registration stores an unverified user, bcrypt password, and only a SHA-256 token hash", async () => {
  const result = await register();
  const user = [...users.values()][0];
  const rawToken = tokenFromEmail();

  assert.equal(result.emailSent, true);
  assert.equal(result.deliveryMode, "email");
  assert.equal(user.email_verified, false);
  assert.equal(await bcrypt.compare("correct horse battery staple", user.password_hash), true);
  assert.equal(tokens.length, 1);
  assert.equal(tokens[0].token_hash.length, 32);
  assert.deepEqual(
    tokens[0].token_hash,
    crypto.createHash("sha256").update(Buffer.from(rawToken, "base64url")).digest()
  );
  assert.equal(JSON.stringify(result).includes(rawToken), false);
  assert.equal(sentEmails[0].recipient, user.email);
  assert.equal(new URL(sentEmails[0].verificationUrl).search, "");
});

test("development delivery prints the configured fragment URL and reports local delivery", async () => {
  process.env.NODE_ENV = "development";
  emailDeliveryService.setEmailDeliveryAdapter(null);
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args);
  try {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const delivery = await emailVerificationService.deliverRegistrationToken({
      user: { email: "private-recipient@example.test" },
      rawToken,
      expiresAt: new Date(),
    });
    assert.deepEqual(delivery, { delivered: true, mode: "development" });
    assert.equal(messages.length, 3);
    assert.match(messages[0][0], /Delivery adapter invoked/);
    assert.match(messages[2][0], /Local delivery succeeded/);
    const loggedText = messages[1].join(" ");
    const printedUrl = loggedText.match(/https:\/\/frontend\.example\.test\/verify-email#[^\s]+/)?.[0];
    assert.ok(printedUrl);
    const parsedUrl = new URL(printedUrl);
    assert.equal(parsedUrl.search, "");
    assert.equal(new URLSearchParams(parsedUrl.hash.slice(1)).get("token"), rawToken);
    assert.equal(loggedText.includes("private-recipient@example.test"), false);
  } finally {
    console.info = originalInfo;
  }
});

test("development delivery reports a safe configuration diagnostic when the verification URL is missing", async () => {
  process.env.NODE_ENV = "development";
  delete process.env.EMAIL_VERIFICATION_URL;
  emailDeliveryService.setEmailDeliveryAdapter(null);
  const originalError = console.error;
  const messages = [];
  console.error = (...args) => messages.push(args.join(" "));
  try {
    const delivery = await emailVerificationService.deliverRegistrationToken({
      user: { email: "private-recipient@example.test" },
      rawToken: crypto.randomBytes(32).toString("base64url"),
      expiresAt: new Date(),
    });
    assert.deepEqual(delivery, { delivered: false, mode: null });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /EMAIL_DELIVERY_NOT_CONFIGURED/);
    assert.match(messages[0], /EMAIL_VERIFICATION_URL/);
    assert.equal(messages[0].includes("private-recipient@example.test"), false);
  } finally {
    console.error = originalError;
  }
});

test("production delivery never prints a local link and fails closed without a provider", async () => {
  process.env.NODE_ENV = "production";
  emailDeliveryService.setEmailDeliveryAdapter(null);
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args);
  try {
    const failure = await emailDeliveryService.sendVerificationEmail({
      recipient: "private-recipient@example.test",
      verificationUrl: "https://frontend.example.test/verify-email#token=not-a-real-token",
      expiresAt: new Date(),
    }).then(() => null, (error) => error);
    assert.equal(failure.code, "EMAIL_DELIVERY_NOT_CONFIGURED");
    assert.equal(messages.length, 0);
  } finally {
    console.info = originalInfo;
  }
});

test("production resend fails with a generic delivery error before account lookup when no provider exists", async () => {
  process.env.NODE_ENV = "production";
  emailDeliveryService.setEmailDeliveryAdapter(null);
  let transactionCalls = 0;
  const originalTransaction = transactionRepository.withTransaction;
  transactionRepository.withTransaction = async (...args) => {
    transactionCalls += 1;
    return originalTransaction(...args);
  };
  try {
    await assert.rejects(
      emailVerificationService.resendVerification("private-recipient@example.test"),
      (error) => error.statusCode === 503
        && error.publicCode === "EMAIL_DELIVERY_NOT_CONFIGURED"
        && error.message === "Verification delivery is temporarily unavailable",
    );
    assert.equal(transactionCalls, 0);
  } finally {
    transactionRepository.withTransaction = originalTransaction;
  }
});

test("verification activates the account and rejects invalid, expired, and reused tokens", async () => {
  const registration = await register();
  const rawToken = tokenFromEmail();
  await emailVerificationService.verifyEmail(rawToken);
  assert.equal([...users.values()][0].email_verified, true);
  assert.ok([...users.values()][0].email_verified_at);

  await assert.rejects(emailVerificationService.verifyEmail(rawToken), (error) =>
    error.publicCode === "INVALID_OR_EXPIRED_VERIFICATION_TOKEN"
  );
  await assert.rejects(emailVerificationService.verifyEmail("A".repeat(43)), (error) =>
    error.publicCode === "INVALID_OR_EXPIRED_VERIFICATION_TOKEN"
  );

  const expired = await register("expired@example.test");
  const expiredToken = tokenFromEmail(sentEmails[1]);
  tokens.find((token) => token.user_id === expired.user.user_id).expires_at = new Date(Date.now() - 1);
  await assert.rejects(emailVerificationService.verifyEmail(expiredToken), (error) =>
    error.publicCode === "INVALID_OR_EXPIRED_VERIFICATION_TOKEN"
  );
});

test("development verification diagnostics report rejection categories without sensitive data", async () => {
  process.env.NODE_ENV = "test";
  const expired = await register("expired-diagnostic@example.test");
  const expiredToken = tokenFromEmail(sentEmails.at(-1));
  tokens.find((token) => token.user_id === expired.user.user_id).expires_at = new Date(Date.now() - 1);
  const consumed = await register("consumed-diagnostic@example.test");
  const consumedToken = tokenFromEmail(sentEmails.at(-1));
  await emailVerificationService.verifyEmail(consumedToken);
  const invalidated = await register("invalidated-diagnostic@example.test");
  const invalidatedToken = tokenFromEmail(sentEmails.at(-1));
  tokens.find((token) => token.user_id === invalidated.user.user_id).invalidated_at = new Date();
  process.env.NODE_ENV = "development";
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args.join(" "));
  try {
    await assert.rejects(emailVerificationService.verifyEmail("malformed"));
    await assert.rejects(emailVerificationService.verifyEmail("A".repeat(43)));
    await assert.rejects(emailVerificationService.verifyEmail(expiredToken));
    await assert.rejects(emailVerificationService.verifyEmail(consumedToken));
    await assert.rejects(emailVerificationService.verifyEmail(invalidatedToken));

    assert.ok(messages.some((message) => message.includes("(malformed)")));
    assert.ok(messages.some((message) => message.includes("(missing)")));
    assert.ok(messages.some((message) => message.includes("(expired)")));
    assert.ok(messages.some((message) => message.includes("(already consumed)")));
    assert.ok(messages.some((message) => message.includes("(invalidated)")));
    assert.equal(messages.join(" ").includes("diagnostic@example.test"), false);
  } finally {
    console.info = originalInfo;
  }
});

test("concurrent verification attempts consume a token only once", async () => {
  await register();
  const rawToken = tokenFromEmail();
  const outcomes = await Promise.allSettled([
    emailVerificationService.verifyEmail(rawToken),
    emailVerificationService.verifyEmail(rawToken),
  ]);

  assert.equal(outcomes.filter((outcome) => outcome.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === "rejected").length, 1);
});

test("resending invalidates the previous token and uses an enumeration-safe result", async () => {
  const registration = await register();
  const oldToken = tokenFromEmail();
  tokens[0].created_at = new Date(Date.now() - 120000);
  const response = await emailVerificationService.resendVerification(registration.user.email);
  const newToken = tokenFromEmail(sentEmails[1]);

  assert.deepEqual(response, { accepted: true });
  assert.equal(tokens[0].invalidated_at !== null, true);
  await assert.rejects(emailVerificationService.verifyEmail(oldToken));
  await emailVerificationService.verifyEmail(newToken);
  assert.deepEqual(await emailVerificationService.resendVerification("missing@example.test"), { accepted: true });
  assert.deepEqual(await emailVerificationService.resendVerification(registration.user.email), { accepted: true });
});

test("resend applies a per-account cooldown and daily issuance cap with a generic result", async () => {
  const registration = await register();
  for (let issue = 0; issue < 4; issue += 1) {
    for (const token of tokens) token.created_at = new Date(Date.now() - 120000);
    assert.deepEqual(
      await emailVerificationService.resendVerification(registration.user.email),
      { accepted: true }
    );
  }

  const messagesBeforeLimit = sentEmails.length;
  for (const token of tokens) token.created_at = new Date(Date.now() - 120000);
  assert.deepEqual(
    await emailVerificationService.resendVerification(registration.user.email),
    { accepted: true }
  );
  assert.equal(sentEmails.length, messagesBeforeLimit);
});

test("development resend diagnostics distinguish cooldown, issue limit, and successful local delivery", async () => {
  process.env.NODE_ENV = "test";
  const registration = await register("resend-diagnostic@example.test");
  process.env.NODE_ENV = "development";
  emailDeliveryService.setEmailDeliveryAdapter(null);
  const originalInfo = console.info;
  const messages = [];
  console.info = (...args) => messages.push(args.join(" "));
  try {
    assert.deepEqual(await emailVerificationService.resendVerification(registration.user.email), { accepted: true });
    assert.ok(messages.some((message) => message.includes("Resend request received")));
    assert.ok(messages.some((message) => message.includes("cooldown applies: true")));
    assert.ok(messages.some((message) => message.includes("24-hour issue limit applies: false")));
    assert.ok(messages.some((message) => message.includes("token created: false (rate limited)")));

    messages.length = 0;
    for (const token of tokens) token.created_at = new Date(Date.now() - 120000);
    assert.deepEqual(await emailVerificationService.resendVerification(registration.user.email), { accepted: true });
    assert.ok(messages.some((message) => message.includes("cooldown applies: false")));
    assert.ok(messages.some((message) => message.includes("token created: true")));
    assert.ok(messages.some((message) => message.includes("Delivery adapter invoked")));
    assert.ok(messages.some((message) => message.includes("Local delivery succeeded")));
    assert.equal(messages.join(" ").includes("resend-diagnostic@example.test"), false);

    messages.length = 0;
    for (const token of tokens) token.created_at = new Date(Date.now() - 120000);
    // Include the fifth issue in the 24-hour window while staying outside cooldown.
    while (tokens.length < 5) {
      await emailVerificationService.resendVerification(registration.user.email);
      for (const token of tokens) token.created_at = new Date(Date.now() - 120000);
    }
    assert.deepEqual(await emailVerificationService.resendVerification(registration.user.email), { accepted: true });
    assert.ok(messages.some((message) => message.includes("24-hour issue limit applies: true")));
    assert.ok(messages.some((message) => message.includes("token created: false (rate limited)")));
  } finally {
    console.info = originalInfo;
  }
});

test("email delivery failure leaves the committed account and token available for resend", async () => {
  emailDeliveryService.setEmailDeliveryAdapter({
    async sendVerificationEmail() { throw new Error("provider detail must not escape"); },
  });

  const result = await register();
  assert.equal(result.emailSent, false);
  assert.equal(users.size, 1);
  assert.equal(tokens.length, 1);
  assert.equal(result.user.email_verified, false);
});

test("unverified users cannot receive JWTs; verified users retain normal login", async () => {
  const registration = await register();
  await assert.rejects(
    authService.loginUser({ email: registration.user.email, password: "correct horse battery staple" }),
    (error) => error.statusCode === 403 && error.publicCode === "EMAIL_NOT_VERIFIED"
  );

  await emailVerificationService.verifyEmail(tokenFromEmail());
  const login = await authService.loginUser({
    email: registration.user.email,
    password: "correct horse battery staple",
  });
  assert.equal(jwt.verify(login.token, process.env.JWT_SECRET).userId, registration.user.user_id);
});

test("unconfigured delivery fails explicitly without exposing token data", async () => {
  emailDeliveryService.setEmailDeliveryAdapter(null);
  const error = await emailDeliveryService.sendVerificationEmail({
    recipient: "person@example.test",
    verificationUrl: "https://example.test/verify?token=never-log-this",
    expiresAt: new Date(),
  }).then(() => null, (failure) => failure);
  assert.equal(error.code, "EMAIL_DELIVERY_NOT_CONFIGURED");
  assert.equal(error.message.includes("never-log-this"), false);
});

const crypto = require("crypto");

const userRepository = require("../repositories/user.repository");
const emailVerificationRepository = require("../repositories/emailVerification.repository");
const transactionRepository = require("../repositories/transaction.repository");
const emailDeliveryService = require("./emailDelivery.service");

const DEFAULT_TOKEN_TTL_SECONDS = 24 * 60 * 60;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_EMAILS_PER_24_HOURS = 5;
const INVALID_TOKEN_MESSAGE = "Verification link is invalid or expired";

const logDevelopmentVerification = (message) => {
  if (process.env.NODE_ENV === "development") {
    console.info(`[NGO Connect] ${message}`);
  }
};

const getTokenTtlSeconds = () => {
  const configured = process.env.EMAIL_VERIFICATION_TOKEN_TTL_SECONDS;
  if (!configured) return DEFAULT_TOKEN_TTL_SECONDS;

  const ttlSeconds = Number(configured);
  if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > 2147483647) {
    throw new Error("EMAIL_VERIFICATION_TOKEN_TTL_SECONDS must be a positive 32-bit integer");
  }
  return ttlSeconds;
};

const generateToken = () => {
  const tokenBytes = crypto.randomBytes(32);
  return {
    rawToken: tokenBytes.toString("base64url"),
    tokenHash: crypto.createHash("sha256").update(tokenBytes).digest(),
  };
};

const parseToken = (rawToken) => {
  if (typeof rawToken !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(rawToken)) return null;
  const tokenBytes = Buffer.from(rawToken, "base64url");
  if (tokenBytes.length !== 32 || tokenBytes.toString("base64url") !== rawToken) return null;
  return tokenBytes;
};

const buildVerificationUrl = (rawToken) => {
  const configuredUrl = process.env.EMAIL_VERIFICATION_URL;
  if (!configuredUrl) {
    const error = new Error("Email verification URL is not configured");
    error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
    throw error;
  }

  let verificationUrl;
  try {
    verificationUrl = new URL(configuredUrl);
  } catch {
    const error = new Error("Email verification URL is not configured correctly");
    error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
    throw error;
  }

  const localHttpHost = ["localhost", "127.0.0.1", "[::1]"].includes(verificationUrl.hostname);
  const secureProtocol = verificationUrl.protocol === "https:"
    || (verificationUrl.protocol === "http:" && localHttpHost);
  if (!secureProtocol || verificationUrl.username || verificationUrl.password) {
    const error = new Error("Email verification URL is not configured correctly");
    error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
    throw error;
  }

  verificationUrl.hash = new URLSearchParams({ token: rawToken }).toString();
  return verificationUrl.toString();
};

const sendVerificationEmail = async ({ user, rawToken, expiresAt }) => {
  const verificationUrl = buildVerificationUrl(rawToken);
  return emailDeliveryService.sendVerificationEmail({
    recipient: user.email,
    verificationUrl,
    expiresAt,
  });
};

const reportDevelopmentDeliveryFailure = (phase, error) => {
  if (process.env.NODE_ENV !== "development") return;
  const code = typeof error?.code === "string" ? error.code : "EMAIL_DELIVERY_FAILED";
  console.error(`[NGO Connect] Verification delivery failed during ${phase} (${code}). Check EMAIL_VERIFICATION_URL and local email delivery configuration.`);
};

const createToken = async (client, userId) => {
  const { rawToken, tokenHash } = generateToken();
  const tokenRecord = await emailVerificationRepository.insertToken(client, {
    userId,
    tokenHash,
    ttlSeconds: getTokenTtlSeconds(),
  });

  return { rawToken, expiresAt: tokenRecord.expires_at };
};

const createPublicError = () => {
  const error = new Error(INVALID_TOKEN_MESSAGE);
  error.statusCode = 400;
  error.publicCode = "INVALID_OR_EXPIRED_VERIFICATION_TOKEN";
  return error;
};

const verifyEmail = async (rawToken) => {
  const tokenBytes = parseToken(rawToken);
  if (!tokenBytes) {
    logDevelopmentVerification("Verification rejected (malformed).");
    throw createPublicError();
  }
  const tokenHash = crypto.createHash("sha256").update(tokenBytes).digest();

  const result = await transactionRepository.withTransaction(async (client) => {
    const tokenOwner = await emailVerificationRepository.findTokenOwner(client, tokenHash);
    if (!tokenOwner) return { verified: false, category: "missing" };
    if (tokenOwner.consumed_at) return { verified: false, category: "already consumed" };
    if (tokenOwner.invalidated_at) return { verified: false, category: "invalidated" };
    if (new Date(tokenOwner.expires_at).getTime() <= Date.now()) {
      return { verified: false, category: "expired" };
    }

    // Resend locks the account before changing its tokens too, avoiding lock-order races.
    const user = await userRepository.lockUserById(client, tokenOwner.user_id);
    if (!user) return { verified: false, category: "missing" };

    const consumed = await emailVerificationRepository.consumeToken(client, tokenHash);
    if (!consumed) {
      const current = await emailVerificationRepository.findTokenOwner(client, tokenHash);
      const category = !current ? "missing"
        : current.consumed_at ? "already consumed"
          : current.invalidated_at ? "invalidated"
            : new Date(current.expires_at).getTime() <= Date.now() ? "expired" : "missing";
      return { verified: false, category };
    }

    await userRepository.markEmailVerified(client, consumed.user_id);
    await emailVerificationRepository.invalidateOutstandingTokens(
      client,
      consumed.user_id,
      consumed.token_id
    );
    return { verified: true };
  });

  if (!result.verified) {
    logDevelopmentVerification(`Verification rejected (${result.category}).`);
    throw createPublicError();
  }
  return { emailVerified: true };
};

const resendVerification = async (email) => {
  logDevelopmentVerification("Resend request received.");
  // Fail globally when production has no provider, without revealing whether
  // the requested address belongs to an account.
  emailDeliveryService.assertDeliveryConfigured();

  const token = await transactionRepository.withTransaction(async (client) => {
    const user = await userRepository.lockVerificationAccountByEmail(client, email);
    if (!user) {
      logDevelopmentVerification("Resend account eligibility: missing account.");
      logDevelopmentVerification("Resend token created: false (account ineligible).");
      return null;
    }
    if (user.email_verified) {
      logDevelopmentVerification("Resend account eligibility: already verified.");
      logDevelopmentVerification("Resend token created: false (account ineligible).");
      return null;
    }
    logDevelopmentVerification("Resend account eligibility: unverified account.");

    const stats = await emailVerificationRepository.getIssueStats(client, user.user_id);
    const latestIssueTime = stats.latest_issue_at && new Date(stats.latest_issue_at).getTime();
    const tooSoon = latestIssueTime && Date.now() - latestIssueTime < RESEND_COOLDOWN_MS;
    const limitReached = stats.issued_in_24_hours >= MAX_EMAILS_PER_24_HOURS;
    logDevelopmentVerification(`Resend cooldown applies: ${Boolean(tooSoon)}.`);
    logDevelopmentVerification(`Resend 24-hour issue limit applies: ${Boolean(limitReached)}.`);
    if (tooSoon || limitReached) {
      logDevelopmentVerification("Resend token created: false (rate limited).");
      return null;
    }

    await emailVerificationRepository.invalidateOutstandingTokens(client, user.user_id);
    const issued = await createToken(client, user.user_id);
    logDevelopmentVerification("Resend token created: true.");
    return { user, ...issued };
  });

  if (token) {
    try {
      await sendVerificationEmail(token);
    } catch (error) {
      // Keep the same public response for sent, failed, missing, and verified accounts.
      reportDevelopmentDeliveryFailure("resend", error);
    }
  }

  return { accepted: true };
};

const deliverRegistrationToken = async ({ user, rawToken, expiresAt }) => {
  try {
    const delivery = await sendVerificationEmail({ user, rawToken, expiresAt });
    return { delivered: true, mode: delivery?.mode ?? "email" };
  } catch (error) {
    // The committed account and token remain available for a later resend.
    reportDevelopmentDeliveryFailure("registration", error);
    return { delivered: false, mode: null };
  }
};

module.exports = {
  createToken,
  verifyEmail,
  resendVerification,
  deliverRegistrationToken,
  parseToken,
};

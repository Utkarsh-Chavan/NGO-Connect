let adapter = null;

const createDeliveryError = () => {
  const error = new Error("Verification delivery is temporarily unavailable");
  error.code = "EMAIL_DELIVERY_NOT_CONFIGURED";
  error.publicCode = "EMAIL_DELIVERY_NOT_CONFIGURED";
  error.statusCode = 503;
  return error;
};

const logDevelopmentDelivery = (message) => {
  if (process.env.NODE_ENV === "development") {
    console.info(`[NGO Connect] ${message}`);
  }
};

const assertDeliveryConfigured = () => {
  if (process.env.NODE_ENV !== "development" && !adapter) throw createDeliveryError();
};

const setEmailDeliveryAdapter = (nextAdapter) => {
  if (nextAdapter !== null && typeof nextAdapter?.sendVerificationEmail !== "function") {
    throw new TypeError("Email delivery adapter must implement sendVerificationEmail");
  }
  adapter = nextAdapter;
};

const developmentTerminalAdapter = Object.freeze({
  async sendVerificationEmail({ verificationUrl }) {
    // Validate the final URL before reporting local delivery as successful.
    const link = new URL(verificationUrl).toString();
    console.info("\n[NGO Connect] Local email verification link:\n%s\n", link);
    return { mode: "development" };
  },
});

const sendVerificationEmail = async ({ recipient, verificationUrl, expiresAt }) => {
  assertDeliveryConfigured();
  if (process.env.NODE_ENV === "development") {
    // Local delivery is explicitly isolated from provider adapters.
    logDevelopmentDelivery("Delivery adapter invoked (local terminal).");
    try {
      const result = await developmentTerminalAdapter.sendVerificationEmail({ recipient, verificationUrl, expiresAt });
      logDevelopmentDelivery("Local delivery succeeded.");
      return result;
    } catch (error) {
      const code = typeof error?.code === "string" ? error.code : "EMAIL_DELIVERY_FAILED";
      logDevelopmentDelivery(`Local delivery failed (${code}).`);
      throw error;
    }
  }

  if (!adapter) throw createDeliveryError();
  await adapter.sendVerificationEmail({ recipient, verificationUrl, expiresAt });
  return { mode: "email" };
};

module.exports = {
  sendVerificationEmail,
  assertDeliveryConfigured,
  setEmailDeliveryAdapter,
};

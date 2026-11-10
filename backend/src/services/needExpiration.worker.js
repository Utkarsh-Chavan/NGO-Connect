const needLifecycleRepository = require("../repositories/needLifecycle.repository");

const EXPIRATION_INTERVAL_MS = 60_000;
let started = false;
let timer = null;
let inFlight = null;

// Coalesce overlapping calls in one process. PostgreSQL row locks provide the
// corresponding coordination across application instances.
const runExpirationSweep = () => {
  if (inFlight) return inFlight;
  inFlight = needLifecycleRepository.expireDueNeeds().finally(() => {
    inFlight = null;
  });
  return inFlight;
};

const logFailure = (error) => {
  // Database error codes are useful operationally and do not include account or token data.
  console.error(`[need-expiration] sweep failed (code=${error?.code || "UNKNOWN"})`);
};

const scheduleNext = () => {
  if (!started) return;
  timer = setTimeout(runScheduledSweep, EXPIRATION_INTERVAL_MS);
  timer.unref?.();
};

const runScheduledSweep = async () => {
  try {
    await runExpirationSweep();
  } catch (error) {
    logFailure(error);
  } finally {
    scheduleNext();
  }
};

const start = () => {
  if (started) return;
  started = true;
  void runScheduledSweep();
};

const stop = async () => {
  started = false;
  if (timer) clearTimeout(timer);
  timer = null;
  if (inFlight) await inFlight.catch(() => {});
};

module.exports = { start, stop, runExpirationSweep };

require("dotenv").config();

const app = require("./app");
const needExpirationWorker = require("./services/needExpiration.worker");
const pool = require("./config/database");

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log(`NGO Connect API running on port ${PORT}`);
});

needExpirationWorker.start();

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  await needExpirationWorker.stop();
  server.close(() => {
    void pool.end();
  });
};

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);

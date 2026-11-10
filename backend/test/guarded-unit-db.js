const path = require("node:path");
require("dotenv").config({ path: path.resolve(__dirname, "../.env"), quiet: true });

const raw = process.env.TEST_DATABASE_URL;
if (!raw) throw new Error("Refusing unit tests: configure TEST_DATABASE_URL for ngo_connect_test.");
const url = new URL(raw);
const databaseName = decodeURIComponent(url.pathname.slice(1));
if (databaseName !== "ngo_connect_test") throw new Error("Refusing unit tests: TEST_DATABASE_URL must target exactly ngo_connect_test.");
if (process.env.NGO_CONNECT_GUARDED_UNIT_DB === "1") {
  if (process.env.DB_NAME !== databaseName) throw new Error("Refusing unit tests: guarded database target changed.");
  return;
}
if (process.env.DB_NAME === databaseName) throw new Error("Refusing unit tests: TEST_DATABASE_URL matches DB_NAME.");

process.env.DB_HOST = decodeURIComponent(url.hostname);
process.env.DB_PORT = url.port || "5432";
process.env.DB_NAME = databaseName;
process.env.DB_USER = decodeURIComponent(url.username);
process.env.DB_PASSWORD = decodeURIComponent(url.password);
process.env.NODE_ENV = "test";
process.env.NGO_CONNECT_GUARDED_UNIT_DB = "1";

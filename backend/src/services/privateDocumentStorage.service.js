const path = require("node:path");
const createLocalPrivateStorage = require("./storage/localPrivateStorage.adapter");

let injectedAdapter = null;
let localAdapter = null;

const getAdapter = () => {
  if (injectedAdapter) return injectedAdapter;
  if (localAdapter) return localAdapter;

  const configuredRoot = process.env.PRIVATE_DOCUMENT_STORAGE_PATH;
  if (!configuredRoot && process.env.NODE_ENV === "production") {
    const error = new Error("Private document storage is not configured");
    error.statusCode = 503;
    error.publicCode = "PRIVATE_STORAGE_NOT_CONFIGURED";
    throw error;
  }

  const defaultRoot = path.resolve(__dirname, "../../../../.ngo-connect-private-documents");
  localAdapter = createLocalPrivateStorage(configuredRoot || defaultRoot);
  return localAdapter;
};

const setStorageAdapter = (adapter) => {
  if (adapter !== null && (
    typeof adapter?.put !== "function"
    || typeof adapter?.open !== "function"
    || typeof adapter?.delete !== "function"
    || typeof adapter?.provider !== "string"
  )) {
    throw new TypeError("Private storage adapter must implement provider, put, open, and delete");
  }
  injectedAdapter = adapter;
};

module.exports = {
  put: (key, buffer) => getAdapter().put(key, buffer),
  open: (key) => getAdapter().open(key),
  delete: (key) => getAdapter().delete(key),
  provider: () => getAdapter().provider,
  setStorageAdapter,
};

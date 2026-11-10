const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

const OBJECT_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|jpeg|png)$/i;

const createLocalPrivateStorage = (rootPath) => {
  const root = path.resolve(rootPath);

  const objectPath = (key) => {
    if (typeof key !== "string" || !OBJECT_KEY_PATTERN.test(key)) {
      const error = new Error("Private document object key is invalid");
      error.statusCode = 400;
      throw error;
    }
    const target = path.resolve(root, key);
    if (path.dirname(target) !== root) {
      const error = new Error("Private document object key is invalid");
      error.statusCode = 400;
      throw error;
    }
    return target;
  };

  const assertRootDirectory = async () => {
    const stats = await fsp.lstat(root);
    if (!stats.isDirectory() || stats.isSymbolicLink()) {
      const error = new Error("Private document storage root must be a real directory");
      error.statusCode = 503;
      throw error;
    }
  };

  return {
    provider: "LOCAL_PRIVATE_FILESYSTEM",
    async put(key, buffer) {
      await fsp.mkdir(root, { recursive: true, mode: 0o700 });
      await assertRootDirectory();
      const target = objectPath(key);
      let handle;
      try {
        handle = await fsp.open(target, "wx", 0o600);
        await handle.writeFile(buffer);
        await handle.close();
      } catch (error) {
        if (handle) {
          await handle.close().catch(() => {});
          await fsp.rm(target, { force: true }).catch(() => {});
        }
        throw error;
      }
    },
    async open(key) {
      await assertRootDirectory();
      const target = objectPath(key);
      const stats = await fsp.lstat(target);
      if (!stats.isFile() || stats.isSymbolicLink()) {
        const error = new Error("Private document was not found");
        error.statusCode = 404;
        throw error;
      }
      return { stream: fs.createReadStream(target), size: stats.size };
    },
    async delete(key) {
      await assertRootDirectory();
      await fsp.rm(objectPath(key), { force: true });
    },
  };
};

module.exports = createLocalPrivateStorage;

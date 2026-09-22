const fs = require("fs");
const path = require("path");

const BUNDLED_UPLOAD_ROOT = path.resolve(__dirname, "..", "..", "public", "uploads");
const UPLOAD_ROOT = path.resolve(
  process.env.UPLOAD_ROOT || BUNDLED_UPLOAD_ROOT
);

function ensureUploadDirectory(...segments) {
  const directory = path.join(UPLOAD_ROOT, ...segments);
  fs.mkdirSync(directory, { recursive: true });
  return directory;
}

function seedBundledUploads() {
  ensureUploadDirectory();
  if (UPLOAD_ROOT === BUNDLED_UPLOAD_ROOT || !fs.existsSync(BUNDLED_UPLOAD_ROOT)) return;

  fs.cpSync(BUNDLED_UPLOAD_ROOT, UPLOAD_ROOT, {
    recursive: true,
    force: false,
    errorOnExist: false
  });
}

module.exports = {
  UPLOAD_ROOT,
  ensureUploadDirectory,
  seedBundledUploads
};

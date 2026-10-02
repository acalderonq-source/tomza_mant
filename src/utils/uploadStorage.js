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

function verificarAlmacenamientoUploads({
  root = UPLOAD_ROOT,
  production = process.env.NODE_ENV === "production",
  configuredRoot = process.env.UPLOAD_ROOT
} = {}) {
  if (production && (!configuredRoot || path.resolve(configuredRoot) === BUNDLED_UPLOAD_ROOT)) {
    return { listo: false, motivo: "persistent_root_not_configured" };
  }

  try {
    if (!fs.statSync(root).isDirectory()) return { listo: false, motivo: "not_a_directory" };
    fs.accessSync(root, fs.constants.R_OK | fs.constants.W_OK);
    return { listo: true, motivo: null };
  } catch (error) {
    return { listo: false, motivo: error.code || "unavailable" };
  }
}

module.exports = {
  UPLOAD_ROOT,
  BUNDLED_UPLOAD_ROOT,
  ensureUploadDirectory,
  seedBundledUploads,
  verificarAlmacenamientoUploads
};

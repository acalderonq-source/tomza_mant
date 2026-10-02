const fs = require("fs");
const path = require("path");

const BUNDLED_UPLOAD_ROOT = path.resolve(__dirname, "..", "..", "public", "uploads");
const RENDER_UPLOAD_ROOT = "/var/data/uploads";

function resolverRaizUploads(env = process.env) {
  const render = env.RENDER === "true";
  if (env.UPLOAD_ROOT) {
    const configuredRoot = path.resolve(env.UPLOAD_ROOT);
    if (render && configuredRoot === BUNDLED_UPLOAD_ROOT) return RENDER_UPLOAD_ROOT;
    return configuredRoot;
  }
  if (render) return RENDER_UPLOAD_ROOT;
  return BUNDLED_UPLOAD_ROOT;
}

const UPLOAD_ROOT = resolverRaizUploads();

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

function rutaEnDiscoPersistente(root, mountInfo) {
  let contenido = mountInfo;
  try {
    if (contenido == null) contenido = fs.readFileSync("/proc/self/mountinfo", "utf8");
  } catch (_error) {
    return false;
  }

  const ruta = path.resolve(root);
  return String(contenido).split("\n").some(linea => {
    const campos = linea.split(" ");
    const puntoMontaje = (campos[4] || "").replace(/\\([0-7]{3})/g, (_match, octal) =>
      String.fromCharCode(parseInt(octal, 8))
    );
    if (!puntoMontaje) return false;

    const relativo = path.relative(path.resolve(puntoMontaje), ruta);
    return relativo === "" || (!relativo.startsWith(`..${path.sep}`) && relativo !== ".." && !path.isAbsolute(relativo));
  });
}

function verificarAlmacenamientoUploads({
  root = UPLOAD_ROOT,
  production = process.env.NODE_ENV === "production",
  configuredRoot = resolverRaizUploads(),
  render = process.env.RENDER === "true",
  mountInfo
} = {}) {
  if (production && (!configuredRoot || path.resolve(configuredRoot) === BUNDLED_UPLOAD_ROOT)) {
    return { listo: false, motivo: "persistent_root_not_configured" };
  }
  if (production && render && !rutaEnDiscoPersistente(root, mountInfo)) {
    return { listo: false, motivo: "persistent_mount_not_attached" };
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
  RENDER_UPLOAD_ROOT,
  resolverRaizUploads,
  rutaEnDiscoPersistente,
  ensureUploadDirectory,
  seedBundledUploads,
  verificarAlmacenamientoUploads
};

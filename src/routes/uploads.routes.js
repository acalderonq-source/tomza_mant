const express = require("express");
const path = require("path");
const { UPLOAD_ROOT } = require("../utils/uploadStorage");

const router = express.Router();
const allowedRoles = new Set(["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"]);
const privateFolders = new Set(["facturas", "cotizaciones"]);
const privateFiles = express.static(UPLOAD_ROOT, {
  dotfiles: "deny",
  fallthrough: false,
  index: false,
  setHeaders(res) {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox");
  }
});

function canViewUploads(user) {
  return Boolean(user && allowedRoles.has(String(user.rol || "").toUpperCase()));
}

function isSafeUploadPath(urlPath) {
  const parts = String(urlPath || "").split("/").filter(Boolean);
  return parts.length === 2 &&
    privateFolders.has(parts[0]) &&
    /^[\w.-]+$/.test(parts[1]) &&
    !parts[1].includes("..");
}

router.use((req, res, next) => {
  if (!req.session?.user) return res.status(401).send("Debe iniciar sesión para ver este archivo.");
  if (!canViewUploads(req.session.user)) {
    return res.status(403).send("No tiene permiso para ver este archivo.");
  }

  if (!isSafeUploadPath(req.path)) {
    return res.status(404).send("Archivo no encontrado.");
  }

  const parts = req.path.split("/").filter(Boolean);
  const resolved = path.resolve(UPLOAD_ROOT, ...parts);
  if (!resolved.startsWith(`${path.resolve(UPLOAD_ROOT)}${path.sep}`)) {
    return res.status(404).send("Archivo no encontrado.");
  }
  return privateFiles(req, res, next);
});

module.exports = router;
module.exports.canViewUploads = canViewUploads;
module.exports.isSafeUploadPath = isSafeUploadPath;

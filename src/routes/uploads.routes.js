const express = require("express");
const path = require("path");
const { UPLOAD_ROOT } = require("../utils/uploadStorage");
const { puedeAbrirRutaPorDepartamento } = require("../utils/departamentos");

const router = express.Router();
const privateFolders = new Set(["facturas", "cotizaciones"]);
const folderAccess = {
  facturas: {
    route: "/compras/facturas",
    roles: new Set(["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD"])
  },
  cotizaciones: {
    route: "/compras/ordenes",
    roles: new Set(["ADMIN", "TALLER", "PROVEEDURIA_TALLER", "CONTABILIDAD", "BODEGUERO"])
  }
};
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

function isSafeUploadPath(urlPath) {
  const parts = String(urlPath || "").split("/").filter(Boolean);
  return parts.length === 2 &&
    privateFolders.has(parts[0]) &&
    /^[\w.-]+$/.test(parts[1]) &&
    !parts[1].includes("..");
}

function canViewUploads(user, urlPath) {
  if (!user || !isSafeUploadPath(urlPath)) return false;

  const folder = String(urlPath).split("/").filter(Boolean)[0];
  const access = folderAccess[folder];
  const role = String(user.rol || "").toUpperCase();
  const department = String(user.departamentoActivo || "TALLER").toUpperCase();

  return Boolean(
    access &&
    access.roles.has(role) &&
    puedeAbrirRutaPorDepartamento(department, access.route)
  );
}

router.use((req, res, next) => {
  if (!req.session?.user) return res.status(401).send("Debe iniciar sesión para ver este archivo.");
  if (!isSafeUploadPath(req.path)) {
    return res.status(404).send("Archivo no encontrado.");
  }
  if (!canViewUploads(req.session.user, req.path)) {
    return res.status(403).send("No tiene permiso para ver este archivo.");
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

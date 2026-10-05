const ROLES_PANTALLA = new Set(["PANTALLA_MECANICOS", "PANTALLA_PESADOS"]);

function esCuentaPantalla(user) {
  return ROLES_PANTALLA.has(String(user?.rol || "").toUpperCase());
}

function restringirCuentaPantalla(req, res, next) {
  if (!esCuentaPantalla(req.session?.user)) return next();

  const metodoLectura = req.method === "GET" || req.method === "HEAD";
  const rutaPermitida = ["/taller/dashboard", "/taller/eventos-prioridades", "/logout"]
    .includes(req.path);
  if (metodoLectura && rutaPermitida) return next();

  return res.status(403).send("Esta cuenta de pantalla solo puede consultar el tablero asignado.");
}

module.exports = { ROLES_PANTALLA, esCuentaPantalla, restringirCuentaPantalla };

const express = require("express");
const QRCode = require("qrcode");
const pool = require("../db");

const router = express.Router();

function requireAdmin(req, res, next) {
  if (!req.session?.user || req.session.user.rol !== "ADMIN") {
    return res.status(403).send("Solo ADMIN puede administrar los carnets.");
  }
  return next();
}

function requireLogin(req, res, next) {
  if (!req.session?.user) {
    const nextUrl = encodeURIComponent(`${req.path}${req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : ""}`);
    return res.redirect(`/?next=${nextUrl}`);
  }
  return next();
}

function basePublicUrl(req) {
  if (process.env.APP_PUBLIC_URL) return process.env.APP_PUBLIC_URL.replace(/\/$/, "");
  if (process.env.RENDER === "true") return "https://tomza-mant.onrender.com";
  return `${req.protocol}://${req.get("host")}`;
}

router.get("/admin/carnets-trabajadores", requireAdmin, async (_req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT c.qr_token,
        MAX(uc.persona_nombre) AS nombre,
        MAX(uc.codigo_trabajador) AS codigo_trabajador,
        MAX(uc.perfil_excel) AS perfil,
        MAX(uc.requiere_cambio_pin) AS requiere_cambio_pin,
        (c.foto_data IS NOT NULL) AS tiene_foto
      FROM carnets_trabajador c
      JOIN usuario_cedulas uc ON uc.cedula = c.cedula
      GROUP BY c.cedula, c.qr_token
      ORDER BY nombre
    `);
    const origin = basePublicUrl(_req);
    const trabajadores = await Promise.all(rows.map(async row => ({
      ...row,
      qr: await QRCode.toDataURL(`${origin}/personal/carnet/${row.qr_token}`, {
        errorCorrectionLevel: "M",
        margin: 1,
        width: 180
      })
    })));
    res.render("carnets_trabajadores", { trabajadores });
  } catch (error) {
    console.error("Error cargando carnets de trabajadores:", error.code || error.message);
    res.status(500).send("No se pudieron cargar los carnets.");
  }
});

router.post("/admin/carnets-trabajadores/:token/foto", requireAdmin, async (req, res) => {
  const token = String(req.params.token || "");
  const dataUrl = String(req.body.foto || "");
  const match = dataUrl.match(/^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/);
  if (!/^[a-f0-9]{64}$/.test(token) || !match) {
    return res.status(400).json({ error: "La foto no tiene un formato válido." });
  }

  const image = Buffer.from(match[1], "base64");
  if (image.length < 4 || image.length > 500_000 || image[0] !== 0xff || image[1] !== 0xd8) {
    return res.status(400).json({ error: "La foto debe ser JPG y no superar 500 KB." });
  }

  try {
    const [result] = await pool.query(
      "UPDATE carnets_trabajador SET foto_data = ?, foto_mime = ? WHERE qr_token = ?",
      [image, "image/jpeg", token]
    );
    if (!result.affectedRows) return res.sendStatus(404);
    res.json({ ok: true });
  } catch (error) {
    console.error("Error guardando foto de carnet:", error.code || error.message);
    res.status(500).json({ error: "No se pudo guardar la foto." });
  }
});

router.get("/personal/carnet/:token/foto", requireLogin, async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) return res.sendStatus(404);
  try {
    const [[row]] = await pool.query(
      "SELECT foto_data, foto_mime FROM carnets_trabajador WHERE qr_token = ? LIMIT 1",
      [token]
    );
    if (!row?.foto_data) return res.sendStatus(404);
    res.set("Cache-Control", "private, no-store");
    res.set("X-Content-Type-Options", "nosniff");
    res.type(row.foto_mime || "image/jpeg").send(row.foto_data);
  } catch (error) {
    console.error("Error cargando foto de carnet:", error.code || error.message);
    res.sendStatus(500);
  }
});

router.get("/personal/carnet/:token", requireLogin, async (req, res) => {
  const token = String(req.params.token || "");
  if (!/^[a-f0-9]{64}$/.test(token)) return res.sendStatus(404);
  try {
    const [[worker]] = await pool.query(`
      SELECT MAX(uc.persona_nombre) AS nombre,
        MAX(uc.codigo_trabajador) AS codigo_trabajador,
        MAX(uc.perfil_excel) AS perfil,
        c.qr_token,
        MAX(c.foto_data IS NOT NULL) AS tiene_foto
      FROM carnets_trabajador c
      JOIN usuario_cedulas uc ON uc.cedula = c.cedula
      WHERE c.qr_token = ?
      GROUP BY c.cedula, c.qr_token
    `, [token]);
    if (!worker) return res.sendStatus(404);
    worker.qr = await QRCode.toDataURL(`${basePublicUrl(req)}/personal/carnet/${worker.qr_token}`, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 180
    });
    res.render("carnet_trabajador", { worker });
  } catch (error) {
    console.error("Error verificando carnet:", error.code || error.message);
    res.status(500).send("No se pudo abrir el carnet.");
  }
});

module.exports = router;

const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== LISTADO DE UNIDADES =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const user = req.session.user;

    let sedesPermitidas = [];

    if (user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sedesPermitidas = [req.session.sedeSeleccionada];
      } else {
        sedesPermitidas = []; // TODAS
      }
    } else {

  // =========================
  // TRAER SEDES EXTRA
  // =========================
  const [extras] = await pool.query(`
    SELECT sede
    FROM usuarios_sedes
    WHERE usuario_id = ?
  `, [user.id]);

  // =========================
  // ARMAR SEDES
  // =========================
  const sedesExtras = extras.map(
    e => e.sede
  );

  const todasLasSedes = [
    ...new Set([
      user.sede,
      ...sedesExtras
    ])
  ];

  // =========================
  // SI ELIGIÓ UNA SEDE
  // =========================
  if (
    req.session.sedeSeleccionada &&
    todasLasSedes.includes(
      req.session.sedeSeleccionada
    )
  ) {

    sedesPermitidas = [
      req.session.sedeSeleccionada
    ];

  } else {

    sedesPermitidas = todasLasSedes;

  }

}

    let sql = `
      SELECT id, placa, sede
      FROM unidades
    `;
    let params = [];

    if (sedesPermitidas.length > 0) {
      sql += " WHERE sede IN (?)";
      params.push(sedesPermitidas);
    }

    sql += " ORDER BY placa";

    const [unidades] = await pool.query(sql, params);

    res.render("unidades", {
      unidades,
      user,
      sedeSeleccionada: req.session.sedeSeleccionada || "TODAS"
    });

  } catch (error) {
    console.error("❌ ERROR /unidades:", error);
    res.status(500).send("Error interno");
  }
});

// ===================== AGREGAR UNIDAD (ADMIN) =====================
router.post("/agregar", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.rol !== "ADMIN") return res.status(403).send("No autorizado");

    const { placa } = req.body;

    const sede = req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS"
      ? req.session.sedeSeleccionada
      : req.session.user.sede;

    await pool.query(
      "INSERT INTO unidades (placa, sede) VALUES (?, ?)",
      [placa.trim().toUpperCase(), sede]
    );

    res.redirect("/unidades");

  } catch (error) {
    console.error("❌ ERROR agregar unidad:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;

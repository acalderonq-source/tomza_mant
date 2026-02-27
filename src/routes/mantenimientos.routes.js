const express = require("express");
const router = express.Router();
const pool = require("../db");

// =====================================================
// 🔧 FUNCIÓN AUXILIAR PARA OBTENER SEDE SEGÚN USUARIO
// =====================================================
function obtenerSedeFiltro(req) {
  let sedeFiltro = null;

  if (req.session.user.rol === "ADMIN") {
    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {
      sedeFiltro = req.session.sedeSeleccionada;
    }
  } else {
    sedeFiltro = req.session.user.sede;
  }

  if (!sedeFiltro) sedeFiltro = req.session.user.sede;
  return sedeFiltro;
}

// =====================================================
// ================== CORRECTIVOS ======================
// =====================================================

// LISTADO
router.get("/correctivos", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const sedeFiltro = obtenerSedeFiltro(req);

    const [rows] = await pool.query(
      `
      SELECT 
        c.id,
        DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        c.trabajo_realizado,
        c.pendiente,
        COALESCE(GROUP_CONCAT(m.nombre SEPARATOR ', '), '—') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_mecanicos cm ON cm.correctivo_id = c.id
      LEFT JOIN mecanicos m ON m.id = cm.mecanico_id
      WHERE c.sede = ?
      GROUP BY c.id
      ORDER BY c.fecha DESC
    `,
      [sedeFiltro]
    );

    res.render("correctivos", { correctivos: rows, user: req.session.user });
  } catch (error) {
    console.error("❌ ERROR listado correctivos:", error);
    res.status(500).send("Error interno");
  }
});

// FORM NUEVO
router.get("/correctivos/nuevo", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["MECANICO", "ADMIN"].includes(req.session.user.rol)) {
      return res.redirect("/mantenimientos");
    }

    const sedeFiltro = obtenerSedeFiltro(req);

    const [unidades] = await pool.query(
      "SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa",
      [sedeFiltro]
    );

    const [mecanicos] = await pool.query(
      "SELECT id, nombre FROM mecanicos WHERE sede = ? ORDER BY nombre",
      [sedeFiltro]
    );

    res.render("correctivos_nuevo", {
      unidades,
      mecanicos,
      user: req.session.user,
    });
  } catch (error) {
    console.error("❌ ERROR form correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// GUARDAR CORRECTIVO
router.post("/correctivos", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["MECANICO", "ADMIN"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { unidad_id, trabajo_realizado, pendiente } = req.body;

    const mecanicos = Array.isArray(req.body.mecanicos)
      ? req.body.mecanicos
      : req.body.mecanicos
      ? [req.body.mecanicos]
      : [];

    if (!mecanicos.length) {
      return res.status(400).send("Debe seleccionar al menos un mecánico.");
    }

    const sedeFiltro = obtenerSedeFiltro(req);

    const [result] = await pool.query(
      `
      INSERT INTO correctivos 
        (unidad_id, sede, trabajo_realizado, pendiente, creado_por)
      VALUES (?, ?, ?, ?, ?)
    `,
      [
        unidad_id,
        sedeFiltro,
        trabajo_realizado,
        pendiente || null,
        req.session.user.id,
      ]
    );

    const correctivoId = result.insertId;

    for (const mecanicoId of mecanicos) {
      await pool.query(
        "INSERT INTO correctivo_mecanicos (correctivo_id, mecanico_id) VALUES (?, ?)",
        [correctivoId, mecanicoId]
      );
    }

    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ ERROR guardar correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// ================= MANTENIMIENTOS ====================
// =====================================================

// LISTADO
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const filtro = req.query.filtro;
    let condiciones = [];
    let params = [];

    if (filtro === "pendientes") condiciones.push("m.estado != 'CERRADO'");
    else if (filtro === "realizados")
      condiciones.push("m.estado = 'CERRADO'");

    const sedeFiltro = obtenerSedeFiltro(req);

    if (sedeFiltro) {
      condiciones.push("u.sede = ?");
      params.push(sedeFiltro);
    }

    const where = condiciones.length
      ? "WHERE " + condiciones.join(" AND ")
      : "";

    const [mantenimientos] = await pool.query(
      `
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        DATE_FORMAT(m.fecha_programada, '%d/%m/%Y') AS fecha_formato,
        m.ejecucion,
        m.pendiente
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      ${where}
      ORDER BY m.fecha_programada DESC, m.id DESC
    `,
      params
    );

    res.render("mantenimientos", {
      mantenimientos,
      user: req.session.user,
      filtro,
      sedeSeleccionada: sedeFiltro || "TODAS",
    });
  } catch (error) {
    console.error("❌ ERROR listado mantenimientos:", error);
    res.status(500).send("Error interno");
  }
});

// DETALLE
router.get("/:id", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");

    const sedeFiltro = obtenerSedeFiltro(req);

    let sql = `
      SELECT 
        m.id,
        m.tipo,
        m.estado,
        m.prioridad,
        m.plan,
        m.ejecucion,
        m.pendiente,
        u.placa,
        u.sede
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.id = ?
    `;

    let params = [req.params.id];

    if (sedeFiltro) {
      sql += " AND u.sede = ?";
      params.push(sedeFiltro);
    }

    const [rows] = await pool.query(sql, params);
    if (!rows.length) return res.send("Mantenimiento no encontrado");

    const [mecanicos] = await pool.query(
      "SELECT id, nombre FROM mecanicos WHERE sede = ? ORDER BY nombre",
      [sedeFiltro]
    );

    const [mecanicosAsignados] = await pool.query(
      `
      SELECT m.id, m.nombre
      FROM mantenimiento_mecanicos mm
      JOIN mecanicos m ON m.id = mm.mecanico_id
      WHERE mm.mantenimiento_id = ?
    `,
      [req.params.id]
    );

    res.render("mantenimiento_detalle", {
      mantenimiento: rows[0],
      user: req.session.user,
      mecanicos,
      mecanicosAsignados,
    });
  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

// GUARDAR PLAN
router.post("/:id/plan", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { plan } = req.body;

    await pool.query(
      "UPDATE mantenimientos SET plan = ? WHERE id = ?",
      [plan, req.params.id]
    );

    res.redirect(`/mantenimientos/${req.params.id}`);
  } catch (error) {
    console.error("❌ ERROR guardando plan:", error);
    res.status(500).send("Error interno");
  }
});

// GUARDAR EJECUCIÓN
router.post("/:id/ejecucion", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { ejecucion, pendiente } = req.body;

    const mecanicos = Array.isArray(req.body.mecanicos)
      ? req.body.mecanicos
      : req.body.mecanicos
      ? [req.body.mecanicos]
      : [];

    if (!mecanicos.length) {
      return res.status(400).send(
        "Debe asignar al menos un mecánico antes de cerrar."
      );
    }

    await pool.query(
      `
      UPDATE mantenimientos 
      SET ejecucion = ?, pendiente = ?, estado = 'CERRADO', fecha_cierre = NOW()
      WHERE id = ?
    `,
      [ejecucion, pendiente, req.params.id]
    );

    await pool.query(
      "DELETE FROM mantenimiento_mecanicos WHERE mantenimiento_id = ?",
      [req.params.id]
    );

    for (const mecanicoId of mecanicos) {
      await pool.query(
        "INSERT INTO mantenimiento_mecanicos (mantenimiento_id, mecanico_id) VALUES (?, ?)",
        [req.params.id, mecanicoId]
      );
    }

    res.redirect("/mantenimientos");
  } catch (error) {
    console.error("❌ ERROR cerrar mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;
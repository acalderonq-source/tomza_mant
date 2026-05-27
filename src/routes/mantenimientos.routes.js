const express = require("express");
const router = express.Router();
const pool = require("../db");
const calcularPuntos = require("../utils/puntajeCorrectivos");
const ExcelJS = require("exceljs");

// =====================================================
// MIDDLEWARE DE AUTENTICACIÓN
// =====================================================
function requireAuth(req, res, next) {
  if (!req.session.user) {
    return res.redirect("/login");
  }
  next();
}

// =====================================================
// OBTENER SEDE SEGÚN USUARIO (nunca undefined)
// =====================================================
function obtenerSedeFiltro(req) {
  if (!req.session.user) return null;

  // ADMIN
  if (req.session.user.rol === "ADMIN") {
    if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
      return req.session.sedeSeleccionada;
    }
    return null;
  }

  // Multi-sede o usuario normal
  return req.session.sedeSeleccionada || req.session.user.sede || null;
}

// =====================================================
// LISTADO DE CORRECTIVOS
// =====================================================
router.get("/correctivos", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    const [rows] = await pool.query(
      `
      SELECT 
        c.id,
        DATE_FORMAT(c.fecha, '%d/%m/%Y %H:%i') AS fecha_formato,
        u.placa,
        c.trabajo_realizado,
        c.pendiente,
        COALESCE(GROUP_CONCAT(DISTINCT m.nombre SEPARATOR ' — '), '—') AS mecanicos
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id
      LEFT JOIN correctivo_trabajos ct ON ct.correctivo_id = c.id
      LEFT JOIN mecanicos m ON m.id = ct.mecanico_id
      WHERE c.sede = ?
      GROUP BY c.id
      ORDER BY c.fecha DESC
      `,
      [sedeFiltro]
    );

    res.render("correctivos", {
      correctivos: rows,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ ERROR listado correctivos:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// EXPORTAR A EXCEL (solo ADMIN)
// =====================================================
router.get("/exportar", requireAuth, async (req, res) => {
  try {
    if (req.session.user.rol !== "ADMIN") {
      return res.status(403).send("No autorizado");
    }

    const [rows] = await pool.query(`
      SELECT 
        u.placa,
        u.sede,
        'PREVENTIVO' AS tipo,
        DATE_FORMAT(m.fecha_programada,'%d/%m/%Y') AS fecha,
        m.estado,
        m.ejecucion
      FROM mantenimientos m
      JOIN unidades u ON u.id = m.unidad_id
      WHERE m.estado = 'CERRADO'

      UNION ALL

      SELECT 
        u.placa,
        u.sede,
        'CORRECTIVO' AS tipo,
        DATE_FORMAT(c.fecha,'%d/%m/%Y') AS fecha,
        'CERRADO' AS estado,
        c.trabajo_realizado AS ejecucion
      FROM correctivos c
      JOIN unidades u ON u.id = c.unidad_id

      ORDER BY fecha DESC
    `);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Mantenimientos");

    sheet.columns = [
      { header: "Placa", key: "placa", width: 15 },
      { header: "Sede", key: "sede", width: 20 },
      { header: "Tipo", key: "tipo", width: 15 },
      { header: "Fecha", key: "fecha", width: 15 },
      { header: "Estado", key: "estado", width: 15 },
      { header: "Ejecución", key: "ejecucion", width: 50 }
    ];

    sheet.addRows(rows);

    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", "attachment; filename=mantenimientos.xlsx");

    await workbook.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error("Error exportando:", err);
    res.status(500).send("Error exportando datos");
  }
});

// =====================================================
// FORMULARIO NUEVO CORRECTIVO
// =====================================================
router.get("/correctivos/nuevo", requireAuth, async (req, res) => {
  try {
    if (!["MECANICO", "ADMIN"].includes(req.session.user.rol)) {
      return res.redirect("/mantenimientos");
    }

    const sedeFiltro = obtenerSedeFiltro(req);
    if (!sedeFiltro) {
      return res.status(400).send("No hay sede seleccionada");
    }

    const [unidades] = await pool.query(
      "SELECT id, placa FROM unidades WHERE sede = ? ORDER BY placa",
      [sedeFiltro]
    );

    let sqlMecanicos = `SELECT id, nombre FROM mecanicos WHERE activo = 1`;
    let paramsMecanicos = [];

    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += ` AND sede = 'Transportadora'`;
    } else {
      sqlMecanicos += ` AND sede = ?`;
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += ` ORDER BY nombre`;

    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);

    res.render("correctivos_nuevo", {
      unidades,
      mecanicos,
      user: req.session.user
    });
  } catch (error) {
    console.error("❌ ERROR form correctivo:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// GUARDAR CORRECTIVO (POST)
// =====================================================
// ===================== GUARDAR CORRECTIVO =====================
router.post("/correctivos", requireAuth, async (req, res) => {
  try {
    console.log("========== [POST] /correctivos ==========");
    const { unidad_id, mecanicos, trabajos, repuestos, pendiente } = req.body;

    // 1. Validar unidad
    if (!unidad_id) {
      return res.status(400).send("Debe seleccionar una unidad.");
    }

    // 2. Normalizar mecánicos seleccionados (siempre array de strings)
    let mecanicosArray = [];
    if (mecanicos !== undefined) {
      mecanicosArray = Array.isArray(mecanicos) ? mecanicos.filter(Boolean) : [mecanicos];
    }
    mecanicosArray = mecanicosArray.map(String); // Convertir todo a string para comparar
    if (mecanicosArray.length === 0) {
      return res.status(400).send("Debe seleccionar al menos un mecánico.");
    }
    console.log("mecanicosArray (strings):", mecanicosArray);

    // 3. Obtener la lista de mecánicos activos de la sede (mismo orden que en el formulario)
    const sedeFiltro = obtenerSedeFiltro(req);
    let sqlMecanicos = `SELECT id FROM mecanicos WHERE activo = 1`;
    let paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += ` AND sede = 'Transportadora'`;
    } else {
      sqlMecanicos += ` AND sede = ?`;
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += ` ORDER BY nombre`;
    const [todosMecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);
    const idsOrdenados = todosMecanicos.map(m => String(m.id)); // Convertir a string también
    console.log("IDs de mecánicos de la sede en orden (strings):", idsOrdenados);

    // 4. Construir resumenGeneral según el tipo de 'trabajos'
    let resumenGeneral = "";

    if (trabajos && typeof trabajos === "object" && !Array.isArray(trabajos)) {
      // Caso OBJETO (clave = id del mecánico)
      console.log("CASO OBJETO");
      for (const idMec of mecanicosArray) {
        const trabajo = (trabajos[idMec] || "").trim();
        if (trabajo.length > 0) {
          resumenGeneral += trabajo + " | ";
        }
      }
    } else if (Array.isArray(trabajos)) {
      // Caso ARRAY - emparejar por posición en el DOM usando la misma lista de la sede
      console.log("CASO ARRAY - emparejando por índice");
      for (let idx = 0; idx < idsOrdenados.length; idx++) {
        const idMec = idsOrdenados[idx]; // string
        if (mecanicosArray.includes(idMec)) {
          const trabajo = (trabajos[idx] || "").trim();
          console.log(`  mec ${idMec} (índice ${idx}) -> trabajo: "${trabajo}"`);
          if (trabajo.length > 0) {
            resumenGeneral += trabajo + " | ";
          }
        }
      }
    }

    console.log("resumenGeneral final:", resumenGeneral);
    if (!resumenGeneral.trim()) {
      return res.status(400).send("Debe escribir al menos un trabajo.");
    }

    // 5. Guardar correctivo (cabecera)
    const puntos = calcularPuntos(resumenGeneral);
    const [result] = await pool.query(
      `INSERT INTO correctivos (unidad_id, sede, trabajo_realizado, pendiente, creado_por, puntos)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [unidad_id, sedeFiltro, resumenGeneral, pendiente || null, req.session.user.id, puntos]
    );
    const correctivoId = result.insertId;

    // 6. Guardar detalles (trabajo y repuestos por mecánico)
   // 6. Guardar detalles (trabajo y repuestos por mecánico)
for (const idMec of mecanicosArray) {
  let trabajo = null;
  let repuesto = null;

  if (trabajos && typeof trabajos === "object" && !Array.isArray(trabajos)) {
    trabajo = (trabajos[idMec] || "").trim() || null;
    repuesto = (repuestos && repuestos[idMec]) ? repuestos[idMec].trim() || null : null;
  } else if (Array.isArray(trabajos)) {
    const idx = idsOrdenados.indexOf(idMec);
    if (idx !== -1) {
      trabajo = (trabajos[idx] || "").trim() || null;
      repuesto = (repuestos && repuestos[idx]) ? repuestos[idx].trim() || null : null;
    }
  }

  if (trabajo || repuesto) {
    await pool.query(
      `INSERT INTO correctivo_trabajos (correctivo_id, mecanico_id, trabajo, repuestos)
       VALUES (?, ?, ?, ?)`,
      [correctivoId, idMec, trabajo, repuesto]
    );
  }
}
    console.log("✅ Correctivo guardado correctamente");
    res.redirect("/mantenimientos/correctivos");
  } catch (error) {
    console.error("❌ ERROR guardar correctivo:", error);
    res.status(500).send("Error interno al guardar el correctivo");
  }
});
// =====================================================
// LISTADO GENERAL DE MANTENIMIENTOS (PREVENTIVOS)
// =====================================================
router.get("/", requireAuth, async (req, res) => {
  try {
    const filtro = req.query.filtro;
    let condiciones = [];
    let params = [];

    if (filtro === "pendientes") condiciones.push("m.estado != 'CERRADO'");
    else if (filtro === "realizados") condiciones.push("m.estado = 'CERRADO'");

    const sedeFiltro = obtenerSedeFiltro(req);
    if (sedeFiltro) {
      condiciones.push("u.sede = ?");
      params.push(sedeFiltro);
    }

    if (req.session.user.rol === "MECANICO") {
      condiciones.push("DATE(m.fecha_programada) <= CURDATE()");
    }

    const where = condiciones.length ? "WHERE " + condiciones.join(" AND ") : "";

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

// =====================================================
// DETALLE DE UN MANTENIMIENTO PREVENTIVO
// =====================================================
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const sedeFiltro = obtenerSedeFiltro(req);
    let sql = `
      SELECT 
        m.id, m.tipo, m.estado, m.prioridad, m.plan, m.ejecucion, m.pendiente,
        u.placa, u.sede
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

    // Mecánicos disponibles
    let sqlMecanicos = `SELECT id, nombre FROM mecanicos WHERE activo = 1`;
    let paramsMecanicos = [];
    if (sedeFiltro === "Transportadora" || sedeFiltro === "Granel") {
      sqlMecanicos += ` AND sede = 'Transportadora'`;
    } else {
      sqlMecanicos += ` AND sede = ?`;
      paramsMecanicos.push(sedeFiltro);
    }
    sqlMecanicos += " ORDER BY nombre";
    const [mecanicos] = await pool.query(sqlMecanicos, paramsMecanicos);

    // Mecánicos ya asignados a este mantenimiento
    const [mecanicosAsignados] = await pool.query(
      `SELECT m.id, m.nombre
       FROM mantenimiento_mecanicos mm
       JOIN mecanicos m ON m.id = mm.mecanico_id
       WHERE mm.mantenimiento_id = ?`,
      [req.params.id]
    );

    res.render("mantenimiento_detalle", {
      mantenimiento: rows[0],
      user: req.session.user,
      mecanicos,
      mecanicosAsignados
    });
  } catch (error) {
    console.error("❌ ERROR detalle mantenimiento:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// GUARDAR PLAN DE TRABAJO (ADMIN/TALLER)
// =====================================================
router.post("/:id/plan", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "TALLER"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }
    const { plan } = req.body;
    await pool.query("UPDATE mantenimientos SET plan = ? WHERE id = ?", [plan, req.params.id]);
    res.redirect(`/mantenimientos/${req.params.id}`);
  } catch (error) {
    console.error("❌ ERROR guardando plan:", error);
    res.status(500).send("Error interno");
  }
});

// =====================================================
// CERRAR MANTENIMIENTO (EJECUCIÓN)
// =====================================================
router.post("/:id/ejecucion", requireAuth, async (req, res) => {
  try {
    if (!["ADMIN", "MECANICO"].includes(req.session.user.rol)) {
      return res.status(403).send("No autorizado");
    }

    const { ejecucion, pendiente } = req.body;

    let mecanicos = [];
    if (req.body.mecanicos !== undefined) {
      mecanicos = Array.isArray(req.body.mecanicos) ? req.body.mecanicos.filter(Boolean) : [req.body.mecanicos];
    }

    if (mecanicos.length === 0) {
      return res.status(400).send("Debe asignar al menos un mecánico antes de cerrar.");
    }

    await pool.query(
      `UPDATE mantenimientos 
       SET ejecucion = ?, pendiente = ?, estado = 'CERRADO', fecha_cierre = NOW()
       WHERE id = ?`,
      [ejecucion, pendiente, req.params.id]
    );

    await pool.query("DELETE FROM mantenimiento_mecanicos WHERE mantenimiento_id = ?", [req.params.id]);

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
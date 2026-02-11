const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== KPIs DE MECÁNICOS (SOLO ADMIN) =====================
router.get("/mecanicos", async (req, res) => {
  try {
    if (!req.session.user) return res.redirect("/login");
    if (req.session.user.rol !== "ADMIN") return res.redirect("/dashboard");

    const desde = req.query.desde;
    const hasta = req.query.hasta;

    // Validación básica
    if (!desde || !hasta) {
      return res.render("kpis_mecanicos", {
        user: req.session.user,
        desde: "",
        hasta: "",
        sede: req.session.sedeSeleccionada || req.session.user.sede,
        totales: []
      });
    }

    // Determinar sede activa
    let sede = null;
    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sede = req.session.sedeSeleccionada;
      }
    } else {
      sede = req.session.user.sede;
    }

    // --- SQL PREVENTIVOS ---
    const SQL_PREVENTIVOS = `
      SELECT 
        m.id AS mecanico_id,
        m.nombre AS mecanico,
        COUNT(mm.mantenimiento_id) AS preventivos
      FROM mantenimiento_mecanicos mm
      JOIN mecanicos m ON m.id = mm.mecanico_id
      JOIN mantenimientos man ON man.id = mm.mantenimiento_id
      WHERE man.estado = 'CERRADO'
        AND man.fecha_cierre BETWEEN ? AND ?
        AND man.sede = ?
      GROUP BY m.id, m.nombre
    `;

    // --- SQL CORRECTIVOS ---
    const SQL_CORRECTIVOS = `
      SELECT 
        m.id AS mecanico_id,
        m.nombre AS mecanico,
        COUNT(cm.correctivo_id) AS correctivos
      FROM correctivo_mecanicos cm
      JOIN mecanicos m ON m.id = cm.mecanico_id
      JOIN correctivos c ON c.id = cm.correctivo_id
      WHERE c.fecha BETWEEN ? AND ?
        AND c.sede = ?
      GROUP BY m.id, m.nombre
    `;

    // Ejecutar queries
    const [preventivosRows] = await pool.query(SQL_PREVENTIVOS, [desde + " 00:00:00", hasta + " 23:59:59", sede]);
    const [correctivosRows] = await pool.query(SQL_CORRECTIVOS, [desde + " 00:00:00", hasta + " 23:59:59", sede]);

    // Unir resultados por mecánico
    const mapa = {};

    preventivosRows.forEach(r => {
      mapa[r.mecanico_id] = {
        mecanico: r.mecanico,
        preventivos: r.preventivos,
        correctivos: 0,
        total_trabajos: r.preventivos
      };
    });

    correctivosRows.forEach(r => {
      if (!mapa[r.mecanico_id]) {
        mapa[r.mecanico_id] = {
          mecanico: r.mecanico,
          preventivos: 0,
          correctivos: r.correctivos,
          total_trabajos: r.correctivos
        };
      } else {
        mapa[r.mecanico_id].correctivos = r.correctivos;
        mapa[r.mecanico_id].total_trabajos += r.correctivos;
      }
    });

    const totales = Object.values(mapa).sort((a, b) => b.total_trabajos - a.total_trabajos);

    res.render("kpis_mecanicos", {
      user: req.session.user,
      desde,
      hasta,
      sede,
      totales
    });

  } catch (error) {
    console.error("❌ ERROR KPIs mecánicos:", error);
    res.status(500).send("Error interno");
  }
});

module.exports = router;

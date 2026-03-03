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

    // ================= VALIDACIÓN =================
    if (!desde || !hasta) {
      return res.render("kpis_mecanicos", {
        user: req.session.user,
        desde: "",
        hasta: "",
        sede: req.session.sedeSeleccionada || req.session.user.sede,
        totales: []
      });
    }

    // ================= SEDE ACTIVA =================
    let sede = null;

    if (req.session.user.rol === "ADMIN") {
      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sede = req.session.sedeSeleccionada;
      }
    } else {
      sede = req.session.user.sede;
    }

    // ================= SQL PRINCIPAL =================
    const SQL = `
      SELECT 
        m.id,
        m.nombre AS mecanico,

        COALESCE(p.preventivos,0) AS preventivos,
        COALESCE(c.correctivos,0) AS correctivos,

        COALESCE(p.preventivos,0) + COALESCE(c.correctivos,0) AS total_trabajos

      FROM mecanicos m

      LEFT JOIN (
        SELECT 
          mm.mecanico_id,
          COUNT(*) AS preventivos
        FROM mantenimiento_mecanicos mm
        JOIN mantenimientos mt ON mt.id = mm.mantenimiento_id
        WHERE mt.estado = 'CERRADO'
          AND mt.fecha_cierre BETWEEN ? AND ?
          AND mt.sede = ?
        GROUP BY mm.mecanico_id
      ) p ON p.mecanico_id = m.id

      LEFT JOIN (
        SELECT 
          cm.mecanico_id,
          COUNT(*) AS correctivos
        FROM correctivo_mecanicos cm
        JOIN correctivos c ON c.id = cm.correctivo_id
        WHERE c.fecha BETWEEN ? AND ?
          AND c.sede = ?
        GROUP BY cm.mecanico_id
      ) c ON c.mecanico_id = m.id

      WHERE m.sede = ?

      ORDER BY total_trabajos DESC
    `;

    const [totales] = await pool.query(SQL, [
      desde + " 00:00:00",
      hasta + " 23:59:59",
      sede,
      desde + " 00:00:00",
      hasta + " 23:59:59",
      sede,
      sede
    ]);

    // ================= RENDER =================
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
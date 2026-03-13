const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== KPIs DE MECÁNICOS =====================
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

    if (req.session.user.rol !== "ADMIN") {

      sede = req.session.user.sede;

    } else {

      if (req.session.sedeSeleccionada && req.session.sedeSeleccionada !== "TODAS") {
        sede = req.session.sedeSeleccionada;
      }

    }

    // ================= SQL PRINCIPAL =================
    const SQL = `
    SELECT 
      m.id,
      m.nombre AS mecanico,

      COALESCE(p.preventivos,0) AS preventivos,
      COALESCE(c.correctivos,0) AS correctivos,

      COALESCE(p.preventivos,0) + COALESCE(c.correctivos,0) AS total_trabajos,

      COALESCE(c.puntos_correctivos,0) AS puntos_correctivos

    FROM mecanicos m

    LEFT JOIN (
      SELECT 
        mm.mecanico_id,
        COUNT(*) AS preventivos
      FROM mantenimiento_mecanicos mm
      JOIN mantenimientos mt ON mt.id = mm.mantenimiento_id
      WHERE mt.estado = 'CERRADO'
        AND mt.fecha_cierre BETWEEN ? AND ?
        ${sede ? "AND mt.sede = ?" : ""}
      GROUP BY mm.mecanico_id
    ) p ON p.mecanico_id = m.id

    LEFT JOIN (
      SELECT 
        cm.mecanico_id,

        COUNT(*) AS correctivos,

        SUM(
          CASE
            WHEN LOWER(c.trabajo_realizado) LIKE '%motor%' THEN 15
            WHEN LOWER(c.trabajo_realizado) LIKE '%clutch%' THEN 10
            WHEN LOWER(c.trabajo_realizado) LIKE '%caja%' THEN 12
            WHEN LOWER(c.trabajo_realizado) LIKE '%freno%' THEN 5
            WHEN LOWER(c.trabajo_realizado) LIKE '%bomba%' THEN 6
            WHEN LOWER(c.trabajo_realizado) LIKE '%aceite%' THEN 2
            WHEN LOWER(c.trabajo_realizado) LIKE '%engrase%' THEN 1
            WHEN LOWER(c.trabajo_realizado) LIKE '%sensor%' THEN 3
            ELSE 1
          END
        ) AS puntos_correctivos

      FROM correctivo_mecanicos cm
      JOIN correctivos c ON c.id = cm.correctivo_id
      WHERE c.fecha BETWEEN ? AND ?
      ${sede ? "AND c.sede = ?" : ""}
      GROUP BY cm.mecanico_id
    ) c ON c.mecanico_id = m.id

    ${sede ? "WHERE m.sede = ?" : ""}

    ORDER BY total_trabajos DESC
    `;

    let params = [
      desde + " 00:00:00",
      hasta + " 23:59:59"
    ];

    if (sede) params.push(sede);

    params.push(
      desde + " 00:00:00",
      hasta + " 23:59:59"
    );

    if (sede) params.push(sede);
    if (sede) params.push(sede);

    const [totales] = await pool.query(SQL, params);

    // ================= CALCULAR EFICIENCIA =================

    let maxPuntos = 0;

    totales.forEach(t => {

      const puntos = (t.preventivos * 1) + (t.puntos_correctivos || 0);

      if (puntos > maxPuntos) {
        maxPuntos = puntos;
      }

      t._puntos = puntos;

    });

    totales.forEach(t => {

      if (maxPuntos === 0) {

        t.eficiencia = 0;

      } else {

        t.eficiencia = Math.round((t._puntos / maxPuntos) * 100);

      }

    });

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
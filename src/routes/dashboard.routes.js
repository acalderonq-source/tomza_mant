const express = require("express");
const router = express.Router();
const pool = require("../db");

// =========================================================
// DASHBOARD PRINCIPAL
// =========================================================

router.get("/", async (req, res) => {

  try {

    // =========================
    // VALIDAR LOGIN
    // =========================
    if (!req.session.user) {
      return res.redirect("/login");
    }

    // =========================
    // FECHA HOY
    // =========================
    const hoy = new Date();

    const fechaHoy =
      hoy.toISOString().split("T")[0];

    // =========================
    // TRAER SEDES EXTRA
    // =========================
    const [extras] = await pool.query(`
      SELECT sede
      FROM usuarios_sedes
      WHERE usuario_id = ?
    `, [req.session.user.id]);

    // =========================
    // ARMAR LISTA COMPLETA
    // =========================
    const sedesPermitidas = [
      ...new Set([
        req.session.user.sede,
        ...extras.map(e => e.sede)
      ])
    ];

    // =========================
    // DEFINIR SEDE ACTUAL
    // =========================
    let sedeFiltro = null;

    // ADMIN
    if (req.session.user.rol === "ADMIN") {

      if (
        req.session.sedeSeleccionada &&
        req.session.sedeSeleccionada !== "TODAS"
      ) {

        sedeFiltro =
          req.session.sedeSeleccionada;

      }

    } else {

      // MULTI-SEDE
      if (
        req.session.sedeSeleccionada &&
        sedesPermitidas.includes(
          req.session.sedeSeleccionada
        )
      ) {

        sedeFiltro =
          req.session.sedeSeleccionada;

      } else {

        sedeFiltro =
          req.session.user.sede;

      }

    }

    console.log(
      "👤 Usuario:",
      req.session.user.usuario
    );

    console.log(
      "📍 Sedes permitidas:",
      sedesPermitidas
    );

    console.log(
      "📍 Sede actual:",
      sedeFiltro
    );

    // =========================
    // QUERY HOY
    // =========================
    let condicionesHoy = [
      "m.fecha_programada = ?"
    ];

    let paramsHoy = [fechaHoy];

    // =========================
    // QUERY KPIS
    // =========================
    let condicionesStats = ["1=1"];

    let paramsStats = [];

    // =========================
    // FILTRO SEDE
    // =========================
    if (sedeFiltro) {

      condicionesHoy.push(
        "u.sede = ?"
      );

      paramsHoy.push(sedeFiltro);

      condicionesStats.push(
        "u.sede = ?"
      );

      paramsStats.push(sedeFiltro);

    }

    // =========================
    // MANTENIMIENTOS HOY
    // =========================
    const sqlHoy = `
      SELECT 
        m.id,
        u.placa,
        u.sede,
        m.tipo,
        m.estado,
        m.plan,
        DATE_FORMAT(
          m.fecha_programada,
          '%d/%m/%Y'
        ) AS fecha

      FROM mantenimientos m

      JOIN unidades u
        ON u.id = m.unidad_id

      WHERE ${condicionesHoy.join(" AND ")}

      ORDER BY m.id
    `;

    const [hoyMantenimientos] =
      await pool.query(
        sqlHoy,
        paramsHoy
      );

    // =========================
    // KPIs
    // =========================
    const sqlStats = `
      SELECT 

        SUM(
          CASE
            WHEN m.estado = 'CERRADO'
            THEN 1
            ELSE 0
          END
        ) AS realizados,

        SUM(
          CASE
            WHEN m.estado != 'CERRADO'
            THEN 1
            ELSE 0
          END
        ) AS pendientes

      FROM mantenimientos m

      JOIN unidades u
        ON u.id = m.unidad_id

      WHERE ${condicionesStats.join(" AND ")}
    `;

    const [statsRows] =
      await pool.query(
        sqlStats,
        paramsStats
      );

    const stats = statsRows[0] || {
      realizados: 0,
      pendientes: 0
    };

    // =========================
    // RENDER
    // =========================
    res.render("dashboard", {

      user: req.session.user,

      hoy: hoyMantenimientos,

      stats,

      sedeSeleccionada:
        sedeFiltro || "TODAS",

      sedesMultiples:
        sedesPermitidas

    });

  } catch (error) {

    console.error(
      "❌ ERROR dashboard:",
      error
    );

    res
      .status(500)
      .send("Internal Server Error");

  }

});

module.exports = router;
const express = require("express");
const router = express.Router();
const pool = require("../db");

// ================= FUNCIONES =================

function hoy() {

  const f = new Date();

  f.setHours(0,0,0,0);

  return f
    .toISOString()
    .slice(0,10);

}

function siguienteDiaHabil(fechaBase) {

  const f = new Date(fechaBase);

  do {

    f.setDate(f.getDate() + 1);

  } while (
    f.getDay() === 0 ||
    f.getDay() === 6
  );

  return f
    .toISOString()
    .slice(0,10);

}

// ================= SEDES =================

async function obtenerSedesPermitidas(req) {

  const [extras] = await pool.query(

    `
    SELECT sede
    FROM usuarios_sedes
    WHERE usuario_id = ?
    `,

    [req.session.user.id]

  );

  const sedes = [

    ...new Set([

      req.session.user.sede,

      ...extras.map(e => e.sede)

    ])

  ].filter(Boolean);

  return sedes;

}

function obtenerSedeFiltro(
  req,
  sedesPermitidas
) {

  if (
    req.session.user.rol === "ADMIN"
  ) {

    if (
      req.session.sedeSeleccionada &&
      req.session.sedeSeleccionada !== "TODAS"
    ) {

      return req.session.sedeSeleccionada;

    }

    return null;

  }

  if (
    req.session.sedeSeleccionada &&
    sedesPermitidas.includes(
      req.session.sedeSeleccionada
    )
  ) {

    return req.session.sedeSeleccionada;

  }

  return sedesPermitidas[0] || null;

}

// =====================================================
// AGENDA HOY
// =====================================================

router.get("/", async (req, res) => {

  try {

    if (!req.session.user)
      return res.redirect("/login");

    const fecha = hoy();

    const sedesPermitidas =
      await obtenerSedesPermitidas(req);

    const sedeFiltro =
      obtenerSedeFiltro(
        req,
        sedesPermitidas
      );

    // =====================================
    // SQL
    // =====================================

    let sql = `
      SELECT 
        'PREVENTIVO' AS tipo_registro,
        m.id AS id,
        u.placa,
        u.sede,
        m.tipo AS subtipo,
        m.estado,
        m.plan AS descripcion,
        DATE_FORMAT(
          m.fecha_programada,
          '%d/%m/%Y'
        ) AS fecha_mostrar
      FROM mantenimientos m
      JOIN unidades u
        ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
        AND m.tipo = 'PREVENTIVO'
    `;

    const params = [fecha];

    // =====================================
    // FILTRO PREVENTIVOS
    // =====================================

    if (sedeFiltro) {

      sql += `
        AND u.sede = ?
      `;

      params.push(sedeFiltro);

    } else if (
      sedesPermitidas.length &&
      req.session.user.rol !== "ADMIN"
    ) {

      sql += `
        AND u.sede IN (?)
      `;

      params.push(sedesPermitidas);

    }

    // =====================================
    // UNION CORRECTIVOS
    // =====================================

    sql += `
      UNION ALL

      SELECT 
        'CORRECTIVO' AS tipo_registro,
        c.id AS id,
        u.placa,
        u.sede,
        NULL AS subtipo,
        'REALIZADO' AS estado,
        c.trabajo_realizado AS descripcion,
        DATE_FORMAT(
          c.fecha,
          '%d/%m/%Y'
        ) AS fecha_mostrar
      FROM correctivos c
      JOIN unidades u
        ON u.id = c.unidad_id
      WHERE DATE(c.fecha) = ?
    `;

    params.push(fecha);

    // =====================================
    // FILTRO CORRECTIVOS
    // =====================================

    if (sedeFiltro) {

      sql += `
        AND u.sede = ?
      `;

      params.push(sedeFiltro);

    } else if (
      sedesPermitidas.length &&
      req.session.user.rol !== "ADMIN"
    ) {

      sql += `
        AND u.sede IN (?)
      `;

      params.push(sedesPermitidas);

    }

    // =====================================
    // ORDER
    // =====================================

    sql += `
      ORDER BY placa ASC
    `;

    const [agenda] =
      await pool.query(
        sql,
        params
      );

    res.render("agenda", {

      agenda,

      fecha,

      user: req.session.user,

      vista: "hoy",

      sedeSeleccionada:
        sedeFiltro || "TODAS",

      sedesPermitidas

    });

  } catch (err) {

    console.error(
      "🔥 ERROR AGENDA:",
      err
    );

    res
      .status(500)
      .send("Error interno");

  }

});

// =====================================================
// AGENDA MAÑANA
// =====================================================

router.get("/manana", async (req, res) => {

  try {

    if (!req.session.user)
      return res.redirect("/login");

    const manana =
      siguienteDiaHabil(new Date());

    const sedesPermitidas =
      await obtenerSedesPermitidas(req);

    const sedeFiltro =
      obtenerSedeFiltro(
        req,
        sedesPermitidas
      );

    let sql = `
      SELECT 
        'PREVENTIVO' AS tipo_registro,
        m.id AS id,
        u.placa,
        u.sede,
        m.tipo AS subtipo,
        m.estado,
        m.plan AS descripcion,
        DATE_FORMAT(
          m.fecha_programada,
          '%d/%m/%Y'
        ) AS fecha_mostrar
      FROM mantenimientos m
      JOIN unidades u
        ON u.id = m.unidad_id
      WHERE m.fecha_programada = ?
        AND m.tipo = 'PREVENTIVO'
    `;

    const params = [manana];

    if (sedeFiltro) {

      sql += `
        AND u.sede = ?
      `;

      params.push(sedeFiltro);

    } else if (
      sedesPermitidas.length &&
      req.session.user.rol !== "ADMIN"
    ) {

      sql += `
        AND u.sede IN (?)
      `;

      params.push(sedesPermitidas);

    }

    sql += `
      UNION ALL

      SELECT 
        'CORRECTIVO' AS tipo_registro,
        c.id AS id,
        u.placa,
        u.sede,
        NULL AS subtipo,
        'REALIZADO' AS estado,
        c.trabajo_realizado AS descripcion,
        DATE_FORMAT(
          c.fecha,
          '%d/%m/%Y'
        ) AS fecha_mostrar
      FROM correctivos c
      JOIN unidades u
        ON u.id = c.unidad_id
      WHERE DATE(c.fecha) = ?
    `;

    params.push(manana);

    if (sedeFiltro) {

      sql += `
        AND u.sede = ?
      `;

      params.push(sedeFiltro);

    } else if (
      sedesPermitidas.length &&
      req.session.user.rol !== "ADMIN"
    ) {

      sql += `
        AND u.sede IN (?)
      `;

      params.push(sedesPermitidas);

    }

    sql += `
      ORDER BY placa ASC
    `;

    const [agenda] =
      await pool.query(
        sql,
        params
      );

    res.render("agenda", {

      agenda,

      fecha: manana,

      user: req.session.user,

      vista: "manana",

      sedeSeleccionada:
        sedeFiltro || "TODAS",

      sedesPermitidas

    });

  } catch (err) {

    console.error(
      "🔥 ERROR AGENDA MAÑANA:",
      err
    );

    res
      .status(500)
      .send("Error interno");

  }

});

module.exports = router;
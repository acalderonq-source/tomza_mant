const express = require("express");
const router = express.Router();
const pool = require("../db");
const { ensureNumeroMantenimientoColumn, asignarNumeroMantenimiento } = require("../utils/mantenimientosNumero");

// devuelve siguiente día hábil (sin sábado ni domingo)
function siguienteDiaHabil(fecha) {
  const f = new Date(fecha);
  do {
    f.setDate(f.getDate() + 1);
  } while (f.getDay() === 0 || f.getDay() === 6); // 0=domingo,6=sábado
  return f.toISOString().slice(0, 10);
}

router.post("/admin/regenerar-agenda", async (req, res) => {
  try {
    if (!req.session.user || req.session.user.rol !== "ADMIN") {
      return res.status(403).send("No autorizado");
    }

    const sedeAdmin = req.session.user.sede || null;

    // 1) BORRAR SOLO PENDIENTES DE SU SEDE (o todos si es super admin)
    if (sedeAdmin) {
      await pool.query(`
        DELETE m FROM mantenimientos m
        JOIN unidades u ON u.id = m.unidad_id
        WHERE m.estado != 'CERRADO'
          AND u.sede = ?
      `, [sedeAdmin]);
    } else {
      await pool.query(`
        DELETE FROM mantenimientos
        WHERE estado != 'CERRADO'
      `);
    }

    // 2) TRAER SOLO UNIDADES DE SU SEDE (o todas)
    let whereSede = "";
    let params = [];

    if (sedeAdmin) {
      whereSede = "AND sede = ?";
      params.push(sedeAdmin);
    }

   // sede que se va a programar
const sede =
  req.session.sedeSeleccionada ||
  req.session.user.sede;

// obtener solo unidades de esa sede
const [unidades] = await pool.query(
  `
  SELECT id, sede
  FROM unidades
  WHERE sede = ?
  ORDER BY id
  `,
  [sede]
);


    // fecha inicio = hoy CR
    const hoy = new Date();
    hoy.setHours(hoy.getHours() - 6);
    const fechaInicio = hoy.toISOString().slice(0, 10);

    // fechas independientes por sede
    let fechaCartago = fechaInicio;
    let fechaLaCruz  = fechaInicio;

    let contCartago = 0;
    let contLaCruz  = 0;

    await ensureNumeroMantenimientoColumn(pool);

    for (const unidad of unidades) {
      let fechaProgramada;

      if (unidad.sede === "Cartago") {
        // 5 por día
        fechaProgramada = fechaCartago;
        contCartago++;

        if (contCartago === 5) {
          fechaCartago = siguienteDiaHabil(fechaCartago);
          contCartago = 0;
        }

      } else if (unidad.sede === "La Cruz") {
        // 2 por día
        fechaProgramada = fechaLaCruz;
        contLaCruz++;

        if (contLaCruz === 2) {
          fechaLaCruz = siguienteDiaHabil(fechaLaCruz);
          contLaCruz = 0;
        }

      } else {
        // otras sedes: 1 por día
        fechaProgramada = fechaCartago;
        fechaCartago = siguienteDiaHabil(fechaCartago);
      }

      const [result] = await pool.query(`
        INSERT INTO mantenimientos
          (unidad_id, tipo, estado, prioridad, fecha_programada)
        VALUES (?, 'PREVENTIVO', 'PROGRAMADO', 'MEDIA', ?)
      `, [unidad.id, fechaProgramada]);
      await asignarNumeroMantenimiento(pool, result.insertId);
    }

    res.redirect("/agenda");

  } catch (error) {
    console.error("❌ Error regenerando agenda:", error);
    res.status(500).send("Error regenerando agenda");
  }
});

module.exports = router;

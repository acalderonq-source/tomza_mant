const express = require("express");
const router = express.Router();
const pool = require("../db");
const {
  agregarTallerParaMecanico,
  esUsuarioTodasSedes,
  obtenerSedesTransporte,
  sedeGranelDesdeUsuario
} = require("../utils/sedes");

/* =========================================================
   CAMBIAR SEDE
========================================================= */

router.post("/cambiar-sede", async (req, res) => {

  try {

    // =========================
    // VALIDAR LOGIN
    // =========================
    if (!req.session.user) {
      return res.redirect("/login");
    }

    const { sede } = req.body;

    const user = req.session.user;

    // =========================
    // USUARIOS CON TODAS LAS SEDES
    // =========================
    if (esUsuarioTodasSedes(user)) {

      req.session.sedeSeleccionada = sede;

      console.log(
        `🟢 ${user.usuario} cambió a sede: ${sede}`
      );

      return res.redirect("/dashboard");

    }

    // =========================
    // TRAER SEDES EXTRA
    // =========================
    const [extras] = await pool.query(`
      SELECT sede
      FROM usuarios_sedes
      WHERE usuario_id = ?
    `, [user.id]);

    // =========================
    // ARMAR LISTA COMPLETA
    // =========================
    const sedeGranelUsuario = sedeGranelDesdeUsuario(user);
    const esPesados = String(user.usuario || "").trim().toLowerCase() === "pesados" || user.rol === "SUPERVISOR_PESADO";
    const sedesPermitidas = sedeGranelUsuario
      ? [sedeGranelUsuario]
      : esPesados
      ? await obtenerSedesTransporte(pool)
      : agregarTallerParaMecanico(user, [user.sede, ...extras.map(e => e.sede)]);

    console.log("👤 Usuario:", user.usuario);

    console.log(
      "📍 Sedes permitidas:",
      sedesPermitidas
    );

    console.log(
      "➡️ Sede solicitada:",
      sede
    );

    // =========================
    // VALIDAR ACCESO
    // =========================
    if (!sedesPermitidas.includes(sede)) {

      return res
        .status(403)
        .send("No autorizado");

    }

    // =========================
    // GUARDAR EN SESIÓN
    // =========================
    req.session.sedeSeleccionada = sede;

    console.log(
      `✅ ${user.usuario} cambió a ${sede}`
    );

    // =========================
    // REDIRECT
    // =========================
    return res.redirect("/dashboard");

  } catch (error) {

    console.error(
      "❌ Error cambiar sede:",
      error
    );

    return res
      .status(500)
      .send("Error cambiando sede");

  }

});

module.exports = router;

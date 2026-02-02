const express = require("express");
const router = express.Router();
const pool = require("../db");

// ===================== LISTAR UNIDADES =====================
router.get("/", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    let sql = `
      SELECT id, placa, sede
      FROM unidades
    `;
    let params = [];

    // 🔐 Filtro por sede
    if (req.session.user.rol !== "ADMIN") {
      sql += " WHERE sede = ?";
      params.push(req.session.user.sede);
    }

    sql += " ORDER BY placa";

    const [unidades] = await pool.query(sql, params);

    res.render("unidades", {
      unidades,
      user: req.session.user,
      error: null
    });

  } catch (error) {
    console.error("❌ ERROR listando unidades:", error);
    res.render("unidades", {
      unidades: [],
      user: req.session.user,
      error: "Error cargando unidades"
    });
  }
});

// ===================== AGREGAR UNIDAD =====================
router.post("/", async (req, res) => {
  console.log("📥 POST /unidades", req.body);

  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (req.session.user.rol !== "ADMIN") {
      return res.status(403).send("No autorizado");
    }

    const { placa, sede } = req.body;

    if (!placa || !sede) {
      return res.render("unidades", {
        unidades: [],
        user: req.session.user,
        error: "Placa y sede son obligatorios"
      });
    }

    await pool.query(
      "INSERT INTO unidades (placa, sede) VALUES (?, ?)",
      [placa.trim(), sede]
    );

    res.redirect("/unidades");

  } catch (error) {
    console.error("❌ ERROR agregando unidad:", error);

    let mensaje = "Error agregando unidad";
    if (error.code === "ER_DUP_ENTRY") {
      mensaje = "Esa placa ya existe";
    }

    res.render("unidades", {
      unidades: [],
      user: req.session.user,
      error: mensaje
    });
  }
});

// ===================== ELIMINAR UNIDAD =====================
router.post("/:id/eliminar", async (req, res) => {
  try {
    if (!req.session.user) {
      return res.redirect("/login");
    }

    if (req.session.user.rol !== "ADMIN") {
      return res.status(403).send("No autorizado");
    }

    const { id } = req.params;

    await pool.query(
      "DELETE FROM unidades WHERE id = ?",
      [id]
    );

    res.redirect("/unidades");

  } catch (error) {
    console.error("❌ ERROR eliminando unidad:", error);
    res.redirect("/unidades");
  }
});

module.exports = router;

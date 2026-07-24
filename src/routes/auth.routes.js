const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");

const router = express.Router();

/**
 * MOSTRAR LOGIN
 */
router.get("/login", (req, res) => {
  res.render("login", { error: null, next: req.query.next || "" });
});

/**
 * PROCESAR LOGIN
 */
router.post("/login", async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const nextUrl = getSafeNextUrl(req.body.next);

    // Validación básica
    if (!usuario || !password) {
      return res.render("login", {
        error: "Debe ingresar usuario y contraseña",
        next: nextUrl
      });
    }

    // Buscar usuario en la base de datos
    const [rows] = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = ? LIMIT 1",
      [usuario]
    );

    console.log("Usuario recibido:", usuario);
    console.log("Rows encontradas:", rows);

    // Usuario no existe
    if (rows.length === 0) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl
      });
    }

    const user = rows[0];

    console.log("Usuario BD:", user);
    console.log("Hash guardado:", user.password);

    // Comparar contraseña
    const match = await bcrypt.compare(password, user.password);

    console.log("Resultado bcrypt:", match);

    if (!match) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl
      });
    }

    // Login correcto -> guardar sesión
    req.session.user = {
      id: user.id,
      nombre: user.nombre || user.usuario,
      usuario: user.usuario,
      rol: user.rol,
      sede: user.sede
    };

    res.redirect(nextUrl || "/dashboard");

  } catch (error) {
    console.error("❌ ERROR LOGIN COMPLETO:", error);
    return res.status(500).send(error.message);
  }
});

function getSafeNextUrl(value) {
  const nextUrl = String(value || "").trim();
  if (!nextUrl || !nextUrl.startsWith("/") || nextUrl.startsWith("//")) return "";
  return nextUrl;
}

/**
 * LOGOUT
 */
router.get("/logout", (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error("Error cerrando sesión:", err);
      return res.redirect("/dashboard");
    }
    res.redirect("/login");
  });
});

module.exports = router;

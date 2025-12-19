const express = require("express");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { signToken } = require("../auth");

const router = express.Router();

router.get("/login", (req, res) => {
  res.render("login", { error: null });
});

router.post("/login", async (req, res) => {
  const { usuario, password } = req.body;

  const [rows] = await pool.query(
    "SELECT * FROM users WHERE usuario=? AND activo=1 LIMIT 1",
    [usuario]
  );

  if (!rows.length) {
    return res.render("login", { error: "Usuario o contraseña incorrecta" });
  }

  const user = rows[0];
  const ok = await bcrypt.compare(password, user.password_hash);

  if (!ok) {
    return res.render("login", { error: "Usuario o contraseña incorrecta" });
  }

  const token = signToken({
    id: user.id,
    nombre: user.nombre,
    rol: user.rol
  });

  res.cookie("token", token, { httpOnly: true });
  res.redirect("/dashboard");
});

router.post("/logout", (req, res) => {
  res.clearCookie("token");
  res.redirect("/login");
});

module.exports = router;

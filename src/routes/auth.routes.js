const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db");
const { DEPARTAMENTOS, esDepartamentoValido } = require("../utils/departamentos");

const router = express.Router();
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req, res) => res.status(429).render("login", {
    error: "Demasiados intentos. Espere 15 minutos antes de volver a intentarlo.",
    next: getSafeNextUrl(req.body?.next),
    departamento: String(req.body?.departamento || ""),
    departamentoNombre: DEPARTAMENTOS.find(item => item.key === String(req.body?.departamento || "").toUpperCase())?.nombre || ""
  })
});

router.get("/", (req, res) => {
  if (req.session.user) return res.redirect("/dashboard");
  res.render("portal_departamentos", {
    departamentos: DEPARTAMENTOS,
    next: getSafeNextUrl(req.query.next)
  });
});

/**
 * MOSTRAR LOGIN
 */
router.get("/login", (req, res) => {
  const departamento = String(req.query.departamento || "").toUpperCase();
  const next = getSafeNextUrl(req.query.next);
  if (!esDepartamentoValido(departamento)) {
    return res.redirect(`/?next=${encodeURIComponent(next)}`);
  }
  res.render("login", {
    error: null,
    next,
    departamento,
    departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
  });
});

/**
 * PROCESAR LOGIN
 */
router.post("/login", loginLimiter, async (req, res) => {
  try {
    const { usuario, password } = req.body;
    const departamento = String(req.body.departamento || "").toUpperCase();
    const nextUrl = getSafeNextUrl(req.body.next);

    if (!esDepartamentoValido(departamento)) {
      return res.redirect(`/?next=${encodeURIComponent(nextUrl)}`);
    }

    // Validación básica
    if (!usuario || !password) {
      return res.render("login", {
        error: "Debe ingresar usuario y contraseña",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    // Buscar usuario en la base de datos
    const [rows] = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = ? LIMIT 1",
      [usuario]
    );

    // Usuario no existe
    if (rows.length === 0) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    const user = rows[0];

    // Comparar contraseña
    const match = await bcrypt.compare(password, user.password);

    if (!match) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    const [departmentRows] = await pool.query(
      "SELECT departamento, es_principal FROM usuario_departamentos WHERE usuario_id = ? ORDER BY es_principal DESC, departamento",
      [user.id]
    );
    const departamentosPermitidos = departmentRows.map(row => row.departamento);
    if (!departamentosPermitidos.includes(departamento)) {
      return res.status(403).render("login", {
        error: "Su cuenta no tiene acceso a ese departamento. Solicite la asignación a un administrador.",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    // Login correcto -> guardar sesión
    const sessionUser = {
      id: user.id,
      nombre: user.nombre || user.usuario,
      usuario: user.usuario,
      rol: user.rol,
      sede: user.sede,
      departamentos: departamentosPermitidos,
      departamentoActivo: departamento
    };

    req.session.regenerate(error => {
      if (error) {
        console.error("Error regenerando sesión:", error);
        return res.status(500).send("No se pudo iniciar sesión.");
      }

      req.session.user = sessionUser;
      res.redirect(nextUrl || "/dashboard");
    });

  } catch (error) {
    console.error("Error procesando login:", error.code || error.message);
    return res.status(500).send("No se pudo iniciar sesión.");
  }
});

router.post("/departamento/activo", (req, res) => {
  const departamento = String(req.body.departamento || "").toUpperCase();
  const user = req.session.user;
  if (!user || !Array.isArray(user.departamentos) || !user.departamentos.includes(departamento)) {
    return res.status(403).send("No tiene acceso a ese departamento.");
  }
  user.departamentoActivo = departamento;
  res.redirect("/dashboard");
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
    res.redirect("/");
  });
});

module.exports = router;

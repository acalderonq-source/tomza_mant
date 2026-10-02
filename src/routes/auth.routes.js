const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db");
const { DEPARTAMENTOS, departamentosPermitidosPorRol, esDepartamentoValido } = require("../utils/departamentos");
const { normalizarCedula } = require("../utils/cedula");

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
    const identificador = String(req.body.usuario || "").trim();
    const password = req.body.password;
    const departamento = String(req.body.departamento || "").toUpperCase();
    const nextUrl = getSafeNextUrl(req.body.next);

    if (!esDepartamentoValido(departamento)) {
      return res.redirect(`/?next=${encodeURIComponent(nextUrl)}`);
    }

    // Validación básica
    if (!identificador || !password) {
      return res.render("login", {
        error: "Debe ingresar usuario y contraseña",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    // Acepta el nombre de usuario o una cédula asociada a uno o más perfiles.
    let [rows] = await pool.query(
      "SELECT * FROM usuarios WHERE usuario = ? LIMIT 1",
      [identificador]
    );

    if (!rows.length) {
      const cedula = normalizarCedula(identificador);
      if (/^\d{9,12}$/.test(cedula)) {
        [rows] = await pool.query(`
          SELECT u.*, uc.persona_nombre, uc.perfil_excel
          FROM usuario_cedulas uc
          JOIN usuarios u ON u.id = uc.usuario_id
          WHERE uc.cedula = ?
          ORDER BY u.usuario
        `, [cedula]);
        if (!rows.length) {
          [rows] = await pool.query("SELECT * FROM usuarios WHERE cedula = ? LIMIT 1", [cedula]);
        }
      }
    }

    // Usuario no existe
    if (rows.length === 0) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    const usersWithValidPassword = [];
    for (const candidate of rows) {
      if (await bcrypt.compare(password, candidate.password)) usersWithValidPassword.push(candidate);
    }

    if (!usersWithValidPassword.length) {
      return res.render("login", {
        error: "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    const uniqueCandidates = [...new Map(usersWithValidPassword.map(user => [user.id, user])).values()];
    if (uniqueCandidates.length > 1) {
      req.session.pendingCedulaLogin = {
        usuarioIds: uniqueCandidates.map(user => user.id),
        departamento,
        next: nextUrl
      };
      return res.render("login", {
        error: null,
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre,
        perfiles: uniqueCandidates.map(user => ({ id: user.id, nombre: user.nombre || user.usuario }))
      });
    }

    return await iniciarSesion(req, res, uniqueCandidates[0], departamento, nextUrl);
  } catch (error) {
    console.error("Error procesando login:", error.code || error.message);
    return res.status(500).send("No se pudo iniciar sesión.");
  }
});

router.post("/login/perfil", async (req, res) => {
  const pending = req.session.pendingCedulaLogin;
  const usuarioId = Number(req.body.usuarioId);
  if (!pending || !pending.usuarioIds.includes(usuarioId)) return res.status(401).redirect("/login?departamento=TALLER");

  try {
    const [[user]] = await pool.query("SELECT * FROM usuarios WHERE id = ? LIMIT 1", [usuarioId]);
    if (!user) {
      delete req.session.pendingCedulaLogin;
      return res.status(401).redirect("/login?departamento=TALLER");
    }
    delete req.session.pendingCedulaLogin;
    return await iniciarSesion(req, res, user, pending.departamento, pending.next);
  } catch (error) {
    console.error("Error seleccionando perfil de cédula:", error.code || error.message);
    return res.status(500).send("No se pudo iniciar sesión.");
  }
});

router.get("/cambiar-clave", (req, res) => {
  if (!req.session.user) return res.redirect("/login?departamento=TALLER");
  if (!req.session.user.requiereCambioPassword) return res.redirect("/dashboard");
  res.render("cambiar_clave", { error: null });
});

router.post("/cambiar-clave", async (req, res) => {
  const user = req.session.user;
  if (!user?.requiereCambioPassword) return res.redirect("/dashboard");
  const password = String(req.body.password || "");
  const confirmar = String(req.body.confirmar || "");
  if (password.length < 12) return res.status(400).render("cambiar_clave", { error: "La contraseña debe tener al menos 12 caracteres." });
  if (password !== confirmar) return res.status(400).render("cambiar_clave", { error: "Las contraseñas no coinciden." });

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE usuarios SET password = ?, requiere_cambio_password = 0 WHERE id = ?", [hash, user.id]);
    user.requiereCambioPassword = false;
    return res.redirect("/dashboard");
  } catch (error) {
    console.error("Error cambiando contraseña inicial:", error.code || error.message);
    return res.status(500).render("cambiar_clave", { error: "No se pudo cambiar la contraseña. Inténtelo de nuevo." });
  }
});

async function iniciarSesion(req, res, user, departamento, nextUrl) {
    const [departmentRows] = await pool.query(
      "SELECT departamento, es_principal FROM usuario_departamentos WHERE usuario_id = ? ORDER BY es_principal DESC, departamento",
      [user.id]
    );
    const departamentosPermitidos = departamentosPermitidosPorRol(
      user.rol,
      departmentRows.map(row => row.departamento)
    );
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
      requiereCambioPassword: Boolean(user.requiere_cambio_password),
      departamentos: departamentosPermitidos,
      departamentoActivo: departamento
    };

    req.session.regenerate(error => {
      if (error) {
        console.error("Error regenerando sesión:", error);
        return res.status(500).send("No se pudo iniciar sesión.");
      }

      req.session.user = sessionUser;
      res.redirect(user.requiere_cambio_password ? "/cambiar-clave" : nextUrl || "/dashboard");
    });
}

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

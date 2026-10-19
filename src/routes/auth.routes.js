const express = require("express");
const bcrypt = require("bcryptjs");
const { rateLimit } = require("express-rate-limit");
const pool = require("../db");
const { DEPARTAMENTOS, departamentosPermitidosPorRol, esDepartamentoValido } = require("../utils/departamentos");
const { normalizarCedula } = require("../utils/cedula");

const { esPropietarioAdministracion } = require('../utils/administracionPrivada');
const {limitarCuenta}=require('../middleware/accountLoginLimit');
const {selloUsuario,leerSello}=require('../middleware/sessionSecurity');
const {sessionSecret}=require('../utils/sessionConfig');
const { registrarIngreso, procesarAvisosIngreso } = require('../utils/ingresosSesion');
const {departamentosInicio,destinoIngreso}=require('../utils/inicioEmpresa');
const limiteCuenta=limitarCuenta(req=>{const id=String(req.body.cedula||req.body.usuario||'').trim();const digits=normalizarCedula(id);return /^\d{9,12}$/.test(digits)?digits:id;});
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
  if (req.session.user) return res.redirect("/inicio");
  res.render("inicio_empresa", {
    departamentos: departamentosInicio(null), user:null,
    next: getSafeNextUrl(req.query.next)
  });
});
router.get('/inicio',(req,res)=>{
  const user=req.session.user;
  if(!user)return res.redirect('/');
  if(['PANTALLA_MECANICOS','PANTALLA_PESADOS'].includes(user.rol))return res.redirect('/taller/dashboard');
  if(user.requiereCambioPassword)return res.redirect('/cambiar-clave');
  res.set('Cache-Control','private, no-store');
  res.render('inicio_empresa',{departamentos:departamentosInicio(user),user,next:''});
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
router.post("/login", loginLimiter, limiteCuenta, async (req, res) => {
  try {
    const identificador = String(req.body.cedula || req.body.usuario || "").trim();
    const cedula = normalizarCedula(identificador);
    const esCedula = /^\d{9,12}$/.test(cedula);
    const password = String(esCedula ? req.body.pin || "" : req.body.password || req.body.pin || "");
    const departamento = String(req.body.departamento || "").toUpperCase();
    const nextUrl = getSafeNextUrl(req.body.next);

    if (!esDepartamentoValido(departamento)) {
      return res.redirect(`/?next=${encodeURIComponent(nextUrl)}`);
    }

    // Validación básica
    if (!identificador || !password || identificador.length>254 || password.length>128) {
      return res.render("login", {
        error: esCedula ? "Ingrese la cédula y el PIN del código de trabajador." : "Debe ingresar usuario y contraseña",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    // Acepta el nombre de usuario o una cédula asociada a uno o más perfiles.
    let rows;
    if (esCedula) {
      [rows] = await pool.query(`
        SELECT u.*, uc.cedula AS cedula_persona, uc.persona_nombre,
          uc.perfil_excel, uc.pin_hash
        FROM usuario_cedulas uc
        JOIN usuarios u ON u.id = uc.usuario_id
        WHERE uc.cedula = ?
        ORDER BY u.usuario
      `, [cedula]);
    } else {
      [rows] = await pool.query(`
        SELECT u.* FROM usuarios u
        WHERE u.usuario = ?
          AND NOT EXISTS (SELECT 1 FROM usuario_cedulas uc WHERE uc.usuario_id = u.id)
        LIMIT 1
      `, [identificador]);
    }

    // Usuario no existe
    if (rows.length === 0) {
      await bcrypt.compare(password,'$2a$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW');
      return res.render("login", {
        error: esCedula ? "Cédula o PIN incorrecto. Verifique sus datos o consulte al administrador." : "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    const usersWithValidPassword = [];
    for (const candidate of rows) {
      const hash = esCedula ? candidate.pin_hash : candidate.password;
      if (hash && await bcrypt.compare(password, hash)) usersWithValidPassword.push(candidate);
    }

    if (!usersWithValidPassword.length) {
      return res.render("login", {
        error: esCedula ? "Cédula o PIN incorrecto. Verifique sus datos o consulte al administrador." : "Usuario o contraseña incorrecta",
        next: nextUrl,
        departamento,
        departamentoNombre: DEPARTAMENTOS.find(item => item.key === departamento)?.nombre
      });
    }

    req.loginVerificado=true;
    let uniqueCandidates = [...new Map(usersWithValidPassword.map(user => [user.id, user])).values()];
    if (departamento === "CARBURACION") {
      const permitidos = [];
      for (const candidate of uniqueCandidates) {
        const [areas] = await pool.query("SELECT departamento FROM usuario_departamentos WHERE usuario_id = ?", [candidate.id]);
        if (departamentosPermitidosPorRol(candidate.rol, areas.map(area => area.departamento)).includes(departamento)) permitidos.push(candidate);
      }
      uniqueCandidates = permitidos;
      if (!uniqueCandidates.length) return res.status(403).render("login", {
        error: "Su cuenta no tiene acceso a Carburación.", next: nextUrl,
        departamento, departamentoNombre: "Carburación"
      });
    }
    if (uniqueCandidates.length > 1) {
      req.session.pendingCedulaLogin = {
        creadoEn:Date.now(),
        sellos:Object.fromEntries(uniqueCandidates.map(u=>[u.id,selloUsuario(u,[],sessionSecret)])),
        usuarioIds: uniqueCandidates.map(user => user.id),
        cedula,
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
  if (!pending || !pending.creadoEn || Date.now()-pending.creadoEn>5*60*1000 || !pending.usuarioIds.includes(usuarioId)) return res.status(401).redirect("/login?departamento=TALLER");

  try {
    const [[user]] = await pool.query(`
      SELECT u.*, uc.cedula AS cedula_persona, uc.persona_nombre, uc.perfil_excel, uc.pin_hash
      FROM usuarios u
      LEFT JOIN usuario_cedulas uc ON uc.usuario_id = u.id AND uc.cedula = ?
      WHERE u.id = ?
      LIMIT 1
    `, [pending.cedula, usuarioId]);
    if (!user || pending.sellos?.[user.id]!==selloUsuario(user,[],sessionSecret)) {
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
  if (password.length < 12 || password.length>128) return res.status(400).render("cambiar_clave", { error: "La contraseña debe tener al menos 12 caracteres." });
  if (password !== confirmar) return res.status(400).render("cambiar_clave", { error: "Las contraseñas no coinciden." });

  try {
    const hash = await bcrypt.hash(password, 12);
    await pool.query("UPDATE usuarios SET password = ?, requiere_cambio_password = 0 WHERE id = ?", [hash, user.id]);
    user.requiereCambioPassword = false;
    user.authStamp=await leerSello(user,pool,sessionSecret);
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
      departmentRows.map(row => row.departamento),
      await esPropietarioAdministracion(user,pool)
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
      authStamp:selloUsuario(user,departmentRows,sessionSecret),
      id: user.id,
      nombre: user.persona_nombre || user.nombre || user.usuario,
      usuario: user.usuario,
      cedula: user.cedula_persona || user.cedula || null,
      perfilExcel: user.perfil_excel || null,
      rol: user.rol,
      sede: user.sede,
      requiereCambioPassword: Boolean(user.requiere_cambio_password),
      departamentos: departamento === "CARBURACION" ? ["CARBURACION"] : departamentosPermitidos,
      departamentoIngreso: departamento,
      departamentoActivo: departamento
    };

    req.session.regenerate(error => {
      if (error) {
        console.error("Error regenerando sesión:", error);
        return res.status(500).send("No se pudo iniciar sesión.");
      }

      req.session.user = sessionUser;
      req.session.authenticatedAt=Date.now();
      req.session.lastActivity=Date.now();
      const esCuentaPantalla = ["PANTALLA_MECANICOS", "PANTALLA_PESADOS"].includes(String(user.rol || "").toUpperCase());
      const destino = departamento === 'CARBURACION' && !esCuentaPantalla && !user.requiere_cambio_password
        ? '/inicio' : destinoIngreso(nextUrl,user);
      const fallar = error => {
        console.error('No se pudo guardar el ingreso:', error.code || 'ERROR');
        req.session.destroy(() => res.status(503).send('No se pudo registrar el inicio de sesion. Intente nuevamente.'));
      };
      req.session.save(error => {
        if (error) return fallar(error);
        registrarIngreso(pool, sessionUser, req).then(() => {
          res.redirect(destino);
          setImmediate(() => procesarAvisosIngreso(pool).catch(error => console.error('Aviso de ingreso pendiente:', error.code || 'ERROR')));
        }).catch(fallar);
      });
    });
}

router.post("/departamento/activo", async (req, res) => {
  const departamento = String(req.body.departamento || "").toUpperCase();
  const user = req.session.user;
  if (user?.departamentoIngreso === "CARBURACION" && departamento !== "CARBURACION") {
    return res.status(403).send("Esta sesión pertenece a Carburación. Cierre sesión para ingresar a otro departamento.");
  }
  if (!user || !Array.isArray(user.departamentos) || !user.departamentos.includes(departamento)) {
    return res.status(403).send("No tiene acceso a ese departamento.");
  }
  try {
    const [rows]=await pool.query('SELECT departamento FROM usuario_departamentos WHERE usuario_id=?',[user.id]);
    const permitidos=departamentosPermitidosPorRol(user.rol,rows.map(r=>r.departamento),await esPropietarioAdministracion(user,pool));
    if(!permitidos.includes(departamento))return res.status(403).send('No tiene acceso a ese departamento.');
  } catch(error) {
    console.error('Cambio de departamento:',error.code || 'ERROR');
    return res.status(503).send('No se pudo verificar el acceso. Intente nuevamente.');
  }
  user.departamentoActivo = departamento;
  res.redirect("/dashboard");
});

function getSafeNextUrl(value) {
  const nextUrl = String(value || "").trim();
  if (!nextUrl || !nextUrl.startsWith("/") || nextUrl.startsWith("//") || /[\\\u0000-\u001f]/.test(nextUrl)) return "";
  return nextUrl;
}

/**
 * LOGOUT
 */
router.get("/logout", (req, res) => {
  const esCuentaPantalla = ["PANTALLA_MECANICOS", "PANTALLA_PESADOS"]
    .includes(String(req.session?.user?.rol || "").toUpperCase());
  req.session.destroy(err => {
    if (err) {
      console.error("Error cerrando sesión:", err);
      return res.redirect("/dashboard");
    }
    res.redirect(esCuentaPantalla ? "/login?departamento=TALLER" : "/");
  });
});

module.exports = router;
module.exports.getSafeNextUrl=getSafeNextUrl;

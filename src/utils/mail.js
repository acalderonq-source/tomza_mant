const nodemailer = require("nodemailer");

const transporters = new Map();

function obtenerConfiguracion(perfil = "default") {
  const sufijo = String(perfil).toUpperCase();
  const usaRemitenteGeneral = !["facturas", "carburacion"].includes(perfil);
  const user = process.env[`EMAIL_USER_${sufijo}`] || (usaRemitenteGeneral ? process.env.EMAIL_USER : "");
  const pass = process.env[`EMAIL_PASS_${sufijo}`] || (usaRemitenteGeneral ? process.env.EMAIL_PASS : "");
  const port = Number(process.env[`EMAIL_PORT_${sufijo}`] || process.env.EMAIL_PORT || 587);

  return {
    user: String(user || "").trim(),
    pass: String(pass || ""),
    host: process.env[`EMAIL_HOST_${sufijo}`] || process.env.EMAIL_HOST || "smtp.office365.com",
    port,
    secure: port === 465,
    requireTLS: port === 587
  };
}

function estaConfigurado(perfil = "default") {
  const { user, pass } = obtenerConfiguracion(perfil);
  return Boolean(user && pass);
}

function obtenerTransporter(perfil) {
  if (!estaConfigurado(perfil)) {
    throw new Error(`Falta configurar EMAIL_USER_${String(perfil).toUpperCase()} y EMAIL_PASS_${String(perfil).toUpperCase()}.`);
  }
  if (!transporters.has(perfil)) {
    const config = obtenerConfiguracion(perfil);
    transporters.set(perfil, nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      requireTLS: config.requireTLS,
      auth: { user: config.user, pass: config.pass }
    }));
  }
  return transporters.get(perfil);
}

async function enviarCorreo(to, subject, html, opciones = {}) {
  const perfil = opciones.perfil || "default";
  const config = obtenerConfiguracion(perfil);
  const { perfil: _perfil, ...opcionesMensaje } = opciones;
  await obtenerTransporter(perfil).sendMail({
    from: opcionesMensaje.nombreRemitente
      ? { name: opcionesMensaje.nombreRemitente, address: config.user }
      : `"Sistema Taller Tomza" <${config.user}>`,
    to,
    subject,
    html,
    ...(opcionesMensaje.cc ? { cc: opcionesMensaje.cc } : {}),
    ...(opcionesMensaje.bcc ? { bcc: opcionesMensaje.bcc } : {}),
    ...(opcionesMensaje.replyTo ? { replyTo: opcionesMensaje.replyTo } : {}),
    ...(opcionesMensaje.text ? { text: opcionesMensaje.text } : {}),
    ...(opcionesMensaje.attachments ? { attachments: opcionesMensaje.attachments } : {})
  });
}

enviarCorreo.estaConfigurado = estaConfigurado;
enviarCorreo.obtenerRemitente = perfil => obtenerConfiguracion(perfil).user;

module.exports = enviarCorreo;

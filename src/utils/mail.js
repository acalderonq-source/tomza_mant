const nodemailer = require("nodemailer");

const port = Number(process.env.EMAIL_PORT || 587);

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || "smtp.office365.com",
  port,
  secure: port === 465,
  requireTLS: port === 587,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarCorreo(to, subject, html, opciones = {}) {
  await transporter.sendMail({
    from: `"Sistema Taller Tomza" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html,
    ...(opciones.cc ? { cc: opciones.cc } : {}),
    ...(opciones.bcc ? { bcc: opciones.bcc } : {}),
    ...(opciones.replyTo ? { replyTo: opciones.replyTo } : {}),
    ...(opciones.text ? { text: opciones.text } : {}),
    ...(opciones.attachments ? { attachments: opciones.attachments } : {})
  });
}

module.exports = enviarCorreo;

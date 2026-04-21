const nodemailer = require("nodemailer");

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

async function enviarCorreo(to, subject, html) {
  await transporter.sendMail({
    from: `"Sistema Taller Tomza" <${process.env.EMAIL_USER}>`,
    to,
    subject,
    html
  });
}

module.exports = enviarCorreo;
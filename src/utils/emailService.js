const sgMail = require('@sendgrid/mail');

sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// Función genérica para enviar correo (con o sin nombre de destinatario)
async function enviarCorreo(destinatario, asunto, cuerpoHTML) {
  if (!destinatario) return;
  const msg = {
    to: destinatario,
    from: 'acalderon.q@tomza.com',
    subject: asunto,
    html: cuerpoHTML
  };
  try {
    await sgMail.send(msg);
    console.log(`✅ Correo enviado a ${destinatario}`);
    return true;
  } catch (error) {
    console.error('❌ Error enviando correo a', destinatario, error.response?.body || error);
    return false;
  }
}

// Genera el HTML estilo "Gas Tomza" para recordatorios MINAE
function generarPlantillaMINAE(titulo, destinatarioNombre, tramite, fechaCita, horaCita, lugarCita, esRecordatorio = false, diasAntes = null) {
  const fechaFormateada = fechaCita ? new Date(fechaCita).toLocaleDateString('es-CR') : 'No definida';
  const horaFormateada = horaCita || 'No definida';
  const lugar = lugarCita || 'No definido';
  const placa = tramite.placa || 'N/A';
  const cr = tramite.cr || 'N/A';

  let intro = '';
  if (esRecordatorio) {
    intro = `<p>Les recordamos que <strong>en ${diasAntes} días, ${fechaFormateada} a las ${horaFormateada}</strong> deben gestionar el siguiente trámite en MINAE:</p>`;
  } else {
    intro = `<p>Se ha agendado una cita MINAE para el <strong>${fechaFormateada} a las ${horaFormateada}</strong>. Detalles a continuación:</p>`;
  }

  return `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <div style="background-color: #1f2937; padding: 15px; text-align: center;">
        <h2 style="color: #fbbf24; margin: 0;">Gas Tomza – Recordatorios</h2>
      </div>
      <div style="padding: 20px; border: 1px solid #e5e7eb; border-top: none;">
        <h3 style="color: #1f2937;">${titulo}</h3>
        <p><strong>Para:</strong> ${destinatarioNombre || 'Supervisores / Taller'}</p>
        ${intro}
        <table style="width: 100%; border-collapse: collapse; margin: 15px 0;">
          <tr><td style="padding: 6px 0;"><strong>🚛 Placa:</strong></td><td>${placa}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>📄 Trámite CR#:</strong></td><td>${cr}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>📅 Fecha cita:</strong></td><td>${fechaFormateada}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>⏰ Hora:</strong></td><td>${horaFormateada}</td></tr>
          <tr><td style="padding: 6px 0;"><strong>📍 Lugar:</strong></td><td>${lugar}</td></tr>
        </table>
        <div style="background-color: #f3f4f6; padding: 12px; border-radius: 8px; margin: 15px 0;">
          <strong>📌 Recomendaciones:</strong>
          <ul style="margin-top: 8px; padding-left: 20px;">
            <li>Llevar la unidad en óptimas condiciones (luces, llantas, cinta reflectiva).</li>
            <li>Documentación original: RTV, tarjeta de circulación, título de propiedad.</li>
            <li>Extintores con marchamo y vigencia (10lb y 20lb).</li>
            <li>Certificado DEKRA al día (si aplica).</li>
            <li>Ir con la unidad VACÍA (sin carga).</li>
          </ul>
        </div>
        <p style="margin-top: 20px;">Por favor confirmar que el camión esté listo con toda la documentación requerida.</p>
        <hr style="margin: 20px 0;">
        <p style="font-size: 0.85em; color: #6b7280;">
          Atentamente,<br>
          <strong>Jeison Flores</strong><br>
          Gas Tomza
        </p>
      </div>
    </div>
  `;
}

// Confirmación de cita (envía a dmartinez.s@tomza.com + email adicional)
async function enviarConfirmacionCita(tramite, fechaCita, horaCita, lugarCita, emailAdicional) {
  const asunto = `✅ Cita MINAE agendada - Trámite ${tramite.cr || tramite.id}`;
  const titulo = 'Confirmación de cita MINAE';
  // Para confirmación, no usamos "días antes", solo intro normal
  const cuerpo = generarPlantillaMINAE(titulo, 'Supervisores / Taller', tramite, fechaCita, horaCita, lugarCita, false, null);
  
  // Enviar a dirección fija
  await enviarCorreo('dmartinez.s@tomza.com', asunto, cuerpo);
  // Enviar a dirección adicional si se proporcionó
  if (emailAdicional && emailAdicional.trim()) {
    await enviarCorreo(emailAdicional.trim(), asunto, cuerpo);
  }
}

// Recordatorio (envía a fijo y al adicional guardado en BD, con el formato de recordatorio)
async function enviarRecordatorio(tramite, diasAntes, fechaCita, lugarCita) {
  const asunto = `⏰ Recordatorio cita MINAE - ${diasAntes} días antes (${tramite.placa})`;
  const titulo = `Recordatorio de cita MINAE – ${diasAntes} días antes`;
  const cuerpo = generarPlantillaMINAE(titulo, 'Supervisores / Taller', tramite, fechaCita, tramite.hora_cita, lugarCita, true, diasAntes);
  
  // Enviar a dirección fija
  await enviarCorreo('dmartinez.s@tomza.com', asunto, cuerpo);
  // Enviar al correo adicional si está guardado en el trámite
  if (tramite.email_notificacion && tramite.email_notificacion.trim()) {
    await enviarCorreo(tramite.email_notificacion.trim(), asunto, cuerpo);
  }
}

module.exports = { enviarCorreo, enviarConfirmacionCita, enviarRecordatorio };
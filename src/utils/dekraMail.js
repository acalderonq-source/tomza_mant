const pool = require("../db");
const enviarCorreo = require("./mail");
const employeeMail = require("./employeeMail");

let actorColumnReady;
async function asegurarColumnaRemitenteCita() {
  if (!actorColumnReady) {
    actorColumnReady = (async () => {
      const [rows] = await pool.query("SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dekra_control' AND COLUMN_NAME = 'cita_creada_por' LIMIT 1");
      if (!rows.length) await pool.query("ALTER TABLE dekra_control ADD COLUMN cita_creada_por INT NULL");
    })().catch(error => { actorColumnReady = null; throw error; });
  }
  return actorColumnReady;
}

const correos = [
  { sede: "Cartago", negocio: null, email: "MGomez.M@tomza.com" },
  { sede: "Alajuela", negocio: "CILINDROS", email: "RVargas.E@tomza.com" },
  { sede: "Alajuela", negocio: "GRANEL", email: "CBolanos.B@tomza.com" },
  { sede: "Perez Zeledon", negocio: null, email: "LSolis.E@tomza.com" },
  { sede: "La Cruz", negocio: null, email: "RGomez.G@tomza.com" }
];

function obtenerCorreosSupervisores(sede, negocio) {
  const sedeNormalizada = String(sede || "").trim().toLocaleLowerCase("es");
  const negocioNormalizado = String(negocio || "").trim().toLocaleUpperCase("es");
  return correos
    .filter(destino => String(destino.sede).trim().toLocaleLowerCase("es") === sedeNormalizada)
    .filter(destino => !destino.negocio || String(destino.negocio).trim().toLocaleUpperCase("es") === negocioNormalizado)
    .map(destino => destino.email);
}

function escaparHtml(valor) {
  return String(valor || "").replace(/[&<>"']/g, caracter => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[caracter]);
}

async function enviarCorreoALista(destinatarios, asunto, html, userId = null) {
  const resultados = await Promise.all(destinatarios.map(async email => {
    try {
      let enviadoPersonal = false;
      let correoPersonal = null;
      if (userId) {
        correoPersonal = await employeeMail.getConnection(userId).catch(() => null);
        try {
          enviadoPersonal = Boolean(await employeeMail.sendAsUser(userId, { to: email, subject: asunto, html }));
        } catch (error) {
          console.warn(`No se pudo usar el correo DEKRA del usuario ${userId}; se usará el remitente general:`, error.message);
        }
      }
      if (!enviadoPersonal) await enviarCorreo(email, asunto, html, {
        perfil: "dekra",
        replyTo: correoPersonal?.correo || undefined
      });
      return true;
    } catch (error) {
      console.error(`Error enviando correo DEKRA a ${email}:`, error.message);
      return false;
    }
  }));
  return resultados.every(Boolean);
}

function generarCorreoCitaDekra(registro, diasAntes = null) {
  const fecha = new Date(`${registro.cita_fecha}T12:00:00Z`).toLocaleDateString("es-CR", { timeZone: "America/Costa_Rica" });
  const hora = String(registro.cita_hora || "Por confirmar").slice(0, 5);
  const lugar = escaparHtml(registro.cita_lugar || "Por confirmar");
  const placa = escaparHtml(registro.placa);
  const encabezado = diasAntes === null
    ? "Cita DEKRA programada"
    : `Recordatorio de cita DEKRA: ${diasAntes} días`;
  const mensaje = diasAntes === null
    ? `Se programó una cita para el <strong>${fecha} a las ${hora}</strong>.`
    : `La cita será en <strong>${diasAntes} días</strong>, el <strong>${fecha} a las ${hora}</strong>.`;
  return `
    <div style="font-family:Arial,sans-serif;max-width:620px;margin:auto;color:#172033">
      <div style="background:#102b59;color:#fff;padding:18px;border-bottom:4px solid #f3b51b">
        <h2 style="margin:0">Gas Tomza | Control DEKRA</h2>
      </div>
      <div style="padding:20px;border:1px solid #dbe3ef">
        <h3>${encabezado}</h3><p>${mensaje}</p>
        <table style="border-collapse:collapse;width:100%">
          <tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Placa</strong></td><td>${placa}</td></tr>
          <tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Sede</strong></td><td>${escaparHtml(registro.sede)}</td></tr>
          <tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Negocio</strong></td><td>${escaparHtml(registro.negocio)}</td></tr>
          ${registro.mes_revision ? `<tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Revisión</strong></td><td>${escaparHtml(registro.mes_revision)}</td></tr>` : ""}
          <tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Fecha</strong></td><td>${fecha}</td></tr>
          <tr><td style="padding:7px;border-bottom:1px solid #ddd"><strong>Hora</strong></td><td>${hora}</td></tr>
          <tr><td style="padding:7px"><strong>Lugar</strong></td><td>${lugar}</td></tr>
        </table>
        <p style="color:#64748b;font-size:13px;margin-top:18px">Mensaje automático del sistema de taller.</p>
      </div>
    </div>`;
}

async function enviarAvisoCitaDekra(registro, destinatarios, diasAntes = null, userId = registro.cita_creada_por || null) {
  const asunto = diasAntes === null
    ? `Cita DEKRA programada - ${registro.placa}`
    : `Recordatorio DEKRA (${diasAntes} días) - ${registro.placa}`;
  return enviarCorreoALista(destinatarios, asunto, generarCorreoCitaDekra(registro, diasAntes), userId);
}

function fechaCostaRicaMasDias(dias) {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Costa_Rica" });
  const [anio, mes, dia] = hoy.split("-").map(Number);
  return new Date(Date.UTC(anio, mes - 1, dia + dias)).toISOString().slice(0, 10);
}

async function enviarRecordatoriosCitasDekra(diasAntes, slot = "primera") {
  await asegurarColumnaRemitenteCita();
  const slots = {
    primera: { fecha: "cita_fecha", estado: "estado", quince: "recordatorio_15d_enviado", dos: "recordatorio_2d_enviado", indice: 0 },
    segunda: { fecha: "cita_fecha_segunda", estado: "estado_segunda", quince: "recordatorio_15d_segundo_enviado", dos: "recordatorio_2d_segundo_enviado", indice: 1 }
  };
  const campos = slots[slot];
  if (!campos) throw new Error("Ciclo de cita DEKRA no válido");
  const bandera = { 15: campos.quince, 2: campos.dos }[diasAntes];
  if (!bandera) throw new Error("Plazo de recordatorio DEKRA no válido");

  const [registros] = await pool.query(
    `SELECT d.id, d.sede, d.negocio, d.mes, d.${campos.fecha} AS cita_fecha,
            d.${slot === "primera" ? "cita_hora" : "cita_hora_segunda"} AS cita_hora,
            d.${slot === "primera" ? "cita_lugar" : "cita_lugar_segunda"} AS cita_lugar,
            d.cita_correos, d.cita_creada_por, u.placa
     FROM dekra_control d
     JOIN unidades u ON u.id = d.unidad_id
     WHERE d.${campos.estado} = 'PENDIENTE' AND d.${campos.fecha} = ? AND d.${bandera} = 0`,
    [fechaCostaRicaMasDias(diasAntes)]
  );

  for (const registro of registros) {
    const destinatarios = String(registro.cita_correos || "").split(/[;,\s]+/).filter(Boolean);
    if (!destinatarios.length) continue;
    const ciclos = {
      "ENE-JUL": ["Enero", "Julio"], "FEB-AGO": ["Febrero", "Agosto"],
      "MAR-SET": ["Marzo", "Setiembre"], "ABR-OCT": ["Abril", "Octubre"],
      "MAY-NOV": ["Mayo", "Noviembre"], "JUN-DIC": ["Junio", "Diciembre"]
    };
    registro.mes_revision = ciclos[registro.mes]?.[campos.indice] || `Revisión ${campos.indice + 1}`;
    const enviado = await enviarAvisoCitaDekra(registro, destinatarios, diasAntes, registro.cita_creada_por);
    if (enviado) {
      await pool.query(`UPDATE dekra_control SET ${bandera} = 1 WHERE id = ?`, [registro.id]);
    }
  }
  return registros.length;
}

async function enviarAlertasDekra() {
  try {

    for (const destino of correos) {

      let sql = `
        SELECT u.placa, d.estado, d.mes, d.negocio
        FROM dekra_control d
        JOIN unidades u ON u.id = d.unidad_id
        WHERE d.sede = ?
      `;

      let params = [destino.sede];

      // 🔥 SI ES ALAJUELA → FILTRAR POR NEGOCIO
      if (destino.negocio) {
        sql += " AND d.negocio = ?";
        params.push(destino.negocio);
      }

      sql += " ORDER BY d.estado, u.placa";

      const [registros] = await pool.query(sql, params);

      if (registros.length === 0) continue;

      // 🔴 SOLO PENDIENTES (MEJOR)
      const pendientes = registros.filter(r => r.estado !== "REALIZADO");

      let filas = pendientes.map(r => `
        <tr>
          <td>${r.placa}</td>
          <td>${r.mes}</td>
          <td>${r.negocio}</td>
          <td style="color:red;">${r.estado}</td>
        </tr>
      `).join("");

      const html = `
        <h2>🚛 Control DEKRA - ${destino.sede}</h2>
        ${destino.negocio ? `<h3>${destino.negocio}</h3>` : ""}

        <p>Unidades pendientes:</p>

        <table border="1" cellpadding="5">
          <tr>
            <th>Placa</th>
            <th>Mes</th>
            <th>Negocio</th>
            <th>Estado</th>
          </tr>
          ${filas}
        </table>

        <p>Total pendientes: <strong>${pendientes.length}</strong></p>
      `;

      await enviarCorreo(destino.email, "⚠️ Alerta DEKRA", html, { perfil: "dekra" });

    }

    console.log("📧 Correos DEKRA enviados correctamente");

  } catch (err) {
    console.error("❌ Error enviando correos:", err);
  }
}

module.exports = enviarAlertasDekra;
module.exports.obtenerCorreosSupervisores = obtenerCorreosSupervisores;
module.exports.enviarAvisoCitaDekra = enviarAvisoCitaDekra;
module.exports.asegurarColumnaRemitenteCita = asegurarColumnaRemitenteCita;
module.exports.enviarRecordatoriosCitasDekra = enviarRecordatoriosCitasDekra;

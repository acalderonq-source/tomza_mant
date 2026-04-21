const pool = require("../db");
const enviarCorreo = require("./mail");

const correos = [
  { sede: "Cartago", negocio: null, email: "MGomez.M@tomza.com" },
  { sede: "Alajuela", negocio: "CILINDROS", email: "RVargas.E@tomza.com" },
  { sede: "Alajuela", negocio: "GRANEL", email: "CBolanos.B@tomza.com" },
  { sede: "Perez Zeledon", negocio: null, email: "LSolis.E@tomza.com" },
  { sede: "La Cruz", negocio: null, email: "RGomez.G@tomza.com" }
];

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

      await enviarCorreo(destino.email, "⚠️ Alerta DEKRA", html);

    }

    console.log("📧 Correos DEKRA enviados correctamente");

  } catch (err) {
    console.error("❌ Error enviando correos:", err);
  }
}

module.exports = enviarAlertasDekra;
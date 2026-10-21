const fs = require("node:fs");
const crypto = require("node:crypto");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { normalizarCedula, cedulaValida } = require("../utils/cedula");

async function crearAccesos(personas, aplicar = false, db = pool) {
  if (!Array.isArray(personas) || !personas.length) throw new Error("Indique las personas que se agregarán.");
  const datos = personas.map(persona => ({ ...persona, cedula: normalizarCedula(persona.cedula) }));
  for (const persona of datos) {
    if (!persona.cedula || !cedulaValida(persona.cedula) || typeof persona.nombre !== "string" || !persona.nombre.trim() || persona.nombre.length > 150 ||
        !/^[a-z0-9._-]{3,60}$/.test(persona.usuario || "") || !/^\d{1,30}$/.test(persona.codigo || "")) throw new Error("Datos de trabajador inválidos.");
  }
  if (new Set(datos.map(persona => persona.cedula)).size !== datos.length) throw new Error("Hay cédulas repetidas.");
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    const resultado = [];
    for (const persona of datos) {
      const [asociaciones] = await connection.query(
        `SELECT u.id, u.usuario, u.rol FROM usuario_cedulas uc JOIN usuarios u ON u.id = uc.usuario_id WHERE uc.cedula = ? FOR UPDATE`, [persona.cedula]
      );
      const [cuentas] = await connection.query("SELECT id, usuario, rol FROM usuarios WHERE usuario = ? OR cedula = ? FOR UPDATE", [persona.usuario, persona.cedula]);
      const existentes = new Map([...asociaciones, ...cuentas].map(cuenta => [cuenta.id, cuenta]));
      if (existentes.size > 1 || [...existentes.values()].some(cuenta => cuenta.rol !== "CONTABILIDAD" || cuenta.usuario !== persona.usuario)) {
        throw new Error(`La cédula ${persona.cedula} ya pertenece a otro perfil; no se modificó.`);
      }
      let usuarioId = [...existentes.values()][0]?.id;
      if (aplicar) {
        if (!usuarioId) {
          const [insert] = await connection.query(
            `INSERT INTO usuarios (nombre, usuario, password, rol, cedula, sede, requiere_cambio_password) VALUES (?, ?, ?, 'CONTABILIDAD', ?, 'TODAS', 0)`,
            [persona.nombre, persona.usuario, await bcrypt.hash(crypto.randomBytes(40).toString("hex"), 12), persona.cedula]
          );
          usuarioId = insert.insertId;
        }
        await connection.query(
          `INSERT INTO usuario_cedulas (cedula, usuario_id, persona_nombre, codigo_trabajador, pin_hash, requiere_cambio_pin, perfil_excel)
           VALUES (?, ?, ?, ?, ?, 1, 'CONTABILIDAD') ON DUPLICATE KEY UPDATE persona_nombre = VALUES(persona_nombre),
           codigo_trabajador = VALUES(codigo_trabajador), pin_hash = VALUES(pin_hash), requiere_cambio_pin = 1, perfil_excel = 'CONTABILIDAD'`,
          [persona.cedula, usuarioId, persona.nombre, persona.codigo, await bcrypt.hash(persona.codigo, 12)]
        );
        await connection.query("INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal) VALUES (?, 'CONTABILIDAD', 1)", [usuarioId]);
        await connection.query("INSERT IGNORE INTO carnets_trabajador (cedula, qr_token) VALUES (?, ?)", [persona.cedula, crypto.randomBytes(32).toString("hex")]);
      }
      resultado.push({ nombre: persona.nombre, cedula: persona.cedula, usuarioId: usuarioId || null, departamento: "CONTABILIDAD", modo: aplicar ? "aplicado" : "revisión" });
    }
    if (aplicar) await connection.commit(); else await connection.rollback();
    return resultado;
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  Promise.resolve().then(() => {
    if (!process.argv[2]) throw new Error("Uso: node src/scripts/crearAccesosContabilidad.js personas.json [--aplicar]");
    return crearAccesos(JSON.parse(fs.readFileSync(process.argv[2], "utf8")), process.argv.includes("--aplicar"));
  }).then(resultado => console.log(JSON.stringify(resultado, null, 2)))
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => pool.end());
}

module.exports = { crearAccesos };

require("dotenv").config();

const crypto = require("node:crypto");
const ExcelJS = require("exceljs");
const bcrypt = require("bcryptjs");
const pool = require("../db");
const { normalizarCedula } = require("../utils/cedula");

const PERFILES = {
  MENSAJERO: ["mensajero"],
  MECANICO_GUAPILES: ["mecanico_guapiles"],
  PESADOS: ["pesados"],
  ADMIN: ["admin"],
  "ENDEREZADO Y PINTURA": ["mecanico", "pesados"],
  MECANICO_LIMON: ["mecanico_limon"],
  MECANICO: ["mecanico"],
  BODEGUERO: ["bodeguero"],
  "JEFE DE TALLER": ["taller"],
  "ASISTENTE TALLER": ["taller"],
  MECANICO_NICOYA: ["mecanico_nicoya"],
  MECANICO_ALAJUELA: ["mecanico_alajuela"],
  MECANICO_LA_CRUZ: ["mecanico_lacruz"],
  MECANICO_RIO_CLARO: ["mecanico_rio_claro"],
  MECANICO_PEREZ_ZELEDON: ["mecanico_pz"],
  PROVEEDURIA_TALLER: ["proveeduria", "taller"]
};

function normalizarPerfil(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toUpperCase();
}

async function leerPersonal(pathArchivo) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(pathArchivo);
  const sheet = workbook.worksheets.at(-1);
  if (!sheet) throw new Error("El archivo no contiene hojas.");

  let cedulaColumn = 0;
  let nombreColumn = 0;
  let codigoColumn = 0;
  let activoColumn = 0;
  sheet.getRow(1).eachCell((cell, column) => {
    const heading = normalizarPerfil(cell.value);
    if (heading === "CEDULA") cedulaColumn = column;
    if (heading === "APELLIDOS Y NOMBRE") nombreColumn = column;
    if (heading === "COD TRAB") codigoColumn = column;
    if (heading === "ACTIVO") activoColumn = column;
  });
  const profileColumn = cedulaColumn + 1;
  if (!cedulaColumn || !nombreColumn || !codigoColumn || !activoColumn) {
    throw new Error("No se encontraron las columnas de cédula, nombre, código y estado.");
  }

  const people = [];
  const seenIds = new Set();
  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    const activo = normalizarPerfil(row.getCell(activoColumn).value);
    if (activo !== "SI") continue;
    const cedula = normalizarCedula(row.getCell(cedulaColumn).value);
    const nombre = String(row.getCell(nombreColumn).value || "").trim();
    const codigoCell = row.getCell(codigoColumn);
    const codigo = String(codigoCell.text || codigoCell.value || "").trim();
    const perfil = normalizarPerfil(row.getCell(profileColumn).value);
    if (!/^\d{9,12}$/.test(cedula) || !nombre || !/^\d{1,30}$/.test(codigo) || !perfil || !PERFILES[perfil]) {
      throw new Error(`La fila ${rowNumber} tiene datos incompletos o un perfil no reconocido.`);
    }
    if (seenIds.has(cedula)) throw new Error(`Hay una cédula repetida en la fila ${rowNumber}.`);
    seenIds.add(cedula);
    people.push({ cedula, nombre, codigo, perfil, targets: PERFILES[perfil] });
  }
  if (!people.length) throw new Error("No se encontraron personas activas para importar.");
  return people;
}

async function importar(pathArchivo, aplicar) {
  const people = await leerPersonal(pathArchivo);
  const usernames = [...new Set(people.flatMap(person => person.targets))];
  const connection = await pool.getConnection();
  let creoNicoya = false;

  try {
    if (aplicar) await connection.beginTransaction();
    const [existing] = await connection.query(
      "SELECT id, usuario, rol FROM usuarios WHERE usuario IN (?) FOR UPDATE",
      [usernames]
    );
    const accounts = new Map(existing.map(user => [user.usuario.toLowerCase(), user]));
    const missing = usernames.filter(username => !accounts.has(username));
    const missingExpected = missing.filter(username => username !== "mecanico_nicoya");
    if (missingExpected.length) throw new Error(`No existen perfiles requeridos: ${missingExpected.join(", " )}.`);

    if (!aplicar) {
      console.log(JSON.stringify({ modo: "simulación", personasActivas: people.length, perfiles: [...new Set(people.map(p => p.perfil))].length, asociaciones: people.reduce((sum, p) => sum + p.targets.length, 0), crearPerfil: missing.includes("mecanico_nicoya") ? "mecanico_nicoya" : null }));
      return;
    }

    const [cedulasLegacy] = await connection.query(
      "SELECT id FROM usuarios WHERE cedula IN (?)",
      [people.map(person => person.cedula)]
    );
    if (cedulasLegacy.length) throw new Error("El Excel contiene cédulas que ya están asignadas fuera de la importación de Taller.");

    if (missing.includes("mecanico_nicoya")) {
      const passwordHash = await bcrypt.hash(crypto.randomBytes(32).toString("base64url"), 12);
      const [result] = await connection.query(
        "INSERT INTO usuarios (nombre, usuario, password, rol, sede, requiere_cambio_password) VALUES (?, ?, ?, 'MECANICO', 'Nicoya', 0)",
        ["Mecánico Nicoya", "mecanico_nicoya", passwordHash]
      );
      const account = { id: result.insertId, usuario: "mecanico_nicoya", rol: "MECANICO" };
      accounts.set(account.usuario, account);
      await connection.query(
        "INSERT IGNORE INTO usuario_departamentos (usuario_id, departamento, es_principal) VALUES (?, 'TALLER', 1)",
        [account.id]
      );
      creoNicoya = true;
    }

    let associations = 0;
    for (const person of people) {
      const pinHash = await bcrypt.hash(person.codigo, 12);
      const accountIds = person.targets.map(username => accounts.get(username)?.id).filter(Boolean);
      await connection.query(
        "DELETE FROM usuario_cedulas WHERE cedula = ? AND usuario_id NOT IN (?)",
        [person.cedula, accountIds]
      );
      for (const username of person.targets) {
        const account = accounts.get(username);
        if (!account) throw new Error(`No se pudo resolver el perfil ${username}.`);
        await connection.query(`
          INSERT INTO usuario_cedulas (cedula, usuario_id, persona_nombre, codigo_trabajador, pin_hash, perfil_excel)
          VALUES (?, ?, ?, NULL, ?, ?)
          ON DUPLICATE KEY UPDATE persona_nombre = VALUES(persona_nombre),
            codigo_trabajador = NULL, pin_hash = VALUES(pin_hash), perfil_excel = VALUES(perfil_excel)
        `, [person.cedula, account.id, person.nombre, pinHash, person.perfil]);
        associations += 1;
      }
    }

    await connection.commit();
    console.log(JSON.stringify({ modo: "aplicado", personasActivas: people.length, asociaciones: associations, creoNicoya }));
  } catch (error) {
    await connection.rollback().catch(() => {});
    throw error;
  } finally {
    connection.release();
  }
}

if (require.main === module) {
  const pathArchivo = process.argv[2];
  const aplicar = process.argv.includes("--aplicar");
  if (!pathArchivo) {
    console.error("Uso: node src/scripts/importTallerCedulas.js <archivo.xlsx> [--aplicar]");
    process.exitCode = 2;
    pool.end();
  } else {
    importar(pathArchivo, aplicar)
      .catch(error => {
        console.error(error.message);
        process.exitCode = 1;
      })
      .finally(() => pool.end());
  }
}

module.exports = { leerPersonal, normalizarPerfil, PERFILES };

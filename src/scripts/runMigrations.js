require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { executeMigrationStatement, parseSingleColumnForeignKey } = require("../utils/sqlMigrationStatements");

const migrationsDir = path.join(__dirname, "..", "..", "migrations");
const LOCK_NAME = "tomza_mant_schema_migrations";
const LOCK_TIMEOUT_SECONDS = 60;

// Todas las consultas usan una sola conexión: el bloqueo GET_LOCK pertenece a esa conexión.
let db = pool;

function checksum(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function splitStatements(sql) {
  return sql
    .replace(/\r\n/g, "\n")
    .split(/;\s*(?:\n|$)/)
    .map(statement => statement
      .split("\n")
      .filter(line => !line.trim().startsWith("--"))
      .join("\n")
      .trim())
    .filter(Boolean);
}

async function foreignKeyAlreadyApplied(statement) {
  const foreignKey = parseSingleColumnForeignKey(statement);
  if (!foreignKey) return false;
  const { table, constraint, column, referencedTable, referencedColumn } = foreignKey;
  const [[existing]] = await db.query(`
    SELECT COUNT(*) AS total
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = ?
      AND CONSTRAINT_NAME = ?
      AND COLUMN_NAME = ?
      AND REFERENCED_TABLE_NAME = ?
      AND REFERENCED_COLUMN_NAME = ?
  `, [table, constraint, column, referencedTable, referencedColumn]);
  return Number(existing?.total || 0) === 1;
}

async function ensureMigrationsTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function ensureFailuresTable() {
  await db.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations_fallidas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL,
      checksum CHAR(64) NOT NULL,
      sentencia_numero INT NOT NULL,
      sentencias_total INT NOT NULL,
      error TEXT NULL,
      fallo_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_schema_migrations_fallidas_filename (filename)
    )
  `);
}

async function registrarFallo(filename, content, numero, total, error) {
  try {
    await db.query(
      "INSERT INTO schema_migrations_fallidas (filename, checksum, sentencia_numero, sentencias_total, error) VALUES (?, ?, ?, ?, ?)",
      [filename, checksum(content), numero, total, String(error?.message || error).slice(0, 4000)]
    );
  } catch (registroError) {
    console.error("No se pudo registrar el fallo de la migracion:", registroError.message);
  }
}

async function acquireLock() {
  const [[row]] = await db.query("SELECT GET_LOCK(?, ?) AS obtenido", [LOCK_NAME, LOCK_TIMEOUT_SECONDS]);
  if (Number(row?.obtenido) !== 1) {
    throw new Error("Otra ejecucion de migraciones esta en curso. Espere a que termine e intente de nuevo.");
  }
}

async function migrationAlreadyRan(filename) {
  const [rows] = await db.query(
    "SELECT checksum FROM schema_migrations WHERE filename = ? LIMIT 1",
    [filename]
  );
  return rows[0]?.checksum || null;
}

async function runMigration(filename) {
  const fullPath = path.join(migrationsDir, filename);
  const content = fs.readFileSync(fullPath, "utf8");
  const statements = splitStatements(content);

  console.log(`Aplicando migracion: ${filename}`);

  for (const [index, statement] of statements.entries()) {
    try {
      await executeMigrationStatement(sql => db.query(sql), statement, {
        isDuplicateForeignKeyAlreadyApplied: foreignKeyAlreadyApplied
      });
    } catch (error) {
      const detalle = `sentencia ${index + 1} de ${statements.length}`;
      await registrarFallo(filename, content, index + 1, statements.length, error);
      error.message = `Error en ${filename} (${detalle}). Las sentencias anteriores ya quedaron aplicadas; revise schema_migrations_fallidas antes de reintentar: ${error.message}`;
      throw error;
    }
  }

  await db.query(
    "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
    [filename, checksum(content)]
  );
}

async function main() {
  db = await pool.getConnection();
  try {
    await acquireLock();
    try {
      await applyPending();
    } finally {
      await db.query("SELECT RELEASE_LOCK(?)", [LOCK_NAME]).catch(() => {});
    }
  } finally {
    db.release();
    db = pool;
  }
}

async function applyPending() {
  await ensureMigrationsTable();
  await ensureFailuresTable();

  const files = fs.existsSync(migrationsDir)
    ? fs.readdirSync(migrationsDir).filter(file => file.endsWith(".sql")).sort()
    : [];

  if (!files.length) {
    console.log("No hay migraciones SQL para ejecutar.");
    return;
  }

  for (const filename of files) {
    const appliedChecksum = await migrationAlreadyRan(filename);
    if (appliedChecksum) {
      const content = fs.readFileSync(path.join(migrationsDir, filename), "utf8");
      if (appliedChecksum !== checksum(content)) {
        throw new Error(`La migracion aplicada ${filename} fue modificada. Cree una nueva migracion en lugar de editar la existente.`);
      }
      console.log(`Ya aplicada: ${filename}`);
      continue;
    }
    await runMigration(filename);
  }

  console.log("Migraciones finalizadas.");
}

main()
  .catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

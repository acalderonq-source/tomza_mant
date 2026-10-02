require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { executeMigrationStatement, parseSingleColumnForeignKey } = require("../utils/sqlMigrationStatements");

const migrationsDir = path.join(__dirname, "..", "..", "migrations");

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
  const [[existing]] = await pool.query(`
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
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      filename VARCHAR(255) NOT NULL UNIQUE,
      checksum CHAR(64) NOT NULL,
      executed_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

async function migrationAlreadyRan(filename) {
  const [rows] = await pool.query(
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

  for (const statement of statements) {
    try {
      await executeMigrationStatement(sql => pool.query(sql), statement, {
        isDuplicateForeignKeyAlreadyApplied: foreignKeyAlreadyApplied
      });
    } catch (error) {
      error.message = `Error en ${filename}: ${error.message}`;
      throw error;
    }
  }

  await pool.query(
    "INSERT INTO schema_migrations (filename, checksum) VALUES (?, ?)",
    [filename, checksum(content)]
  );
}

async function main() {
  await ensureMigrationsTable();

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

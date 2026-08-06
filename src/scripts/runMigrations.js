require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");

const migrationsDir = path.join(__dirname, "..", "..", "migrations");
const IGNORABLE_CODES = new Set([
  "ER_DUP_FIELDNAME",
  "ER_DUP_KEYNAME",
  "ER_TABLE_EXISTS_ERROR"
]);

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
    "SELECT id FROM schema_migrations WHERE filename = ? LIMIT 1",
    [filename]
  );
  return rows.length > 0;
}

async function runMigration(filename) {
  const fullPath = path.join(migrationsDir, filename);
  const content = fs.readFileSync(fullPath, "utf8");
  const statements = splitStatements(content);

  console.log(`Aplicando migracion: ${filename}`);

  for (const statement of statements) {
    try {
      await pool.query(statement);
    } catch (error) {
      if (IGNORABLE_CODES.has(error.code)) {
        console.warn(`Omitido por existir (${error.code}) en ${filename}`);
        continue;
      }
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
    if (await migrationAlreadyRan(filename)) {
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

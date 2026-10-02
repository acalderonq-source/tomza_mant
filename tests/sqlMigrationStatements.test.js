const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitAlterTableStatement, executeMigrationStatement } = require("../src/utils/sqlMigrationStatements");

test("separa acciones ALTER TABLE sin dividir comas dentro de tipos, funciones o literales", () => {
  const statements = splitAlterTableStatement(`ALTER TABLE \`unidades\`
    ADD COLUMN marca VARCHAR(100) NULL AFTER sede,
    ADD COLUMN modelo VARCHAR(120) NULL AFTER marca,
    ADD COLUMN nota VARCHAR(120) NOT NULL DEFAULT 'A, B'`);

  assert.deepEqual(statements, [
    "ALTER TABLE `unidades` ADD COLUMN marca VARCHAR(100) NULL AFTER sede",
    "ALTER TABLE `unidades` ADD COLUMN modelo VARCHAR(120) NULL AFTER marca",
    "ALTER TABLE `unidades` ADD COLUMN nota VARCHAR(120) NOT NULL DEFAULT 'A, B'"
  ]);
});

test("una acción duplicada no omite las siguientes acciones de la migración", async () => {
  const executed = [];
  await executeMigrationStatement(async sql => {
    executed.push(sql);
    if (sql.includes("ADD COLUMN sede")) {
      throw Object.assign(new Error("duplicate column"), { code: "ER_DUP_FIELDNAME" });
    }
  }, "ALTER TABLE bodega_movimientos ADD COLUMN sede VARCHAR(120), ADD COLUMN ubicacion VARCHAR(120), ADD INDEX idx_mov_ubicacion (ubicacion)");

  assert.equal(executed.length, 3);
  assert.ok(executed[0].includes("ADD COLUMN sede"));
  assert.ok(executed[1].includes("ADD COLUMN ubicacion"));
  assert.ok(executed[2].includes("ADD INDEX idx_mov_ubicacion"));
});

test("los errores reales detienen la ejecución de la migración", async () => {
  const executed = [];
  await assert.rejects(() => executeMigrationStatement(async sql => {
    executed.push(sql);
    if (sql.includes("ADD COLUMN ubicacion")) {
      throw Object.assign(new Error("bad schema"), { code: "ER_BAD_FIELD_ERROR" });
    }
  }, "ALTER TABLE bodega_movimientos ADD COLUMN sede VARCHAR(120), ADD COLUMN ubicacion VARCHAR(120), ADD INDEX idx_mov_ubicacion (ubicacion)"), {
    code: "ER_BAD_FIELD_ERROR"
  });
  assert.equal(executed.length, 2);
});

test("no altera consultas ni sentencias que no sean ALTER TABLE", () => {
  const statement = "SELECT 'ALTER TABLE x ADD COLUMN y', COUNT(*) FROM tabla";
  assert.deepEqual(splitAlterTableStatement(statement), [statement]);
});

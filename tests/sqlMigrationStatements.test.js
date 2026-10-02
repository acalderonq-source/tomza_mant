const { test } = require("node:test");
const assert = require("node:assert/strict");
const { splitAlterTableStatement, parseSingleColumnForeignKey, executeMigrationStatement } = require("../src/utils/sqlMigrationStatements");

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

test("reintentar una llave foranea ya aplicada conserva las demas acciones", async () => {
  const executed = [];
  const statements = "ALTER TABLE bodega_movimientos ADD COLUMN sede VARCHAR(120), ADD CONSTRAINT fk_bodega_mov_origen FOREIGN KEY (movimiento_origen_id) REFERENCES bodega_movimientos(id)";
  await executeMigrationStatement(async sql => {
    executed.push(sql);
    if (sql.includes("ADD CONSTRAINT")) {
      throw Object.assign(new Error("duplicate foreign key constraint name"), { code: "ER_FK_DUP_NAME" });
    }
  }, statements, {
    isDuplicateForeignKeyAlreadyApplied: async action => action.includes("fk_bodega_mov_origen")
  });

  assert.equal(executed.length, 2);
  assert.match(executed[0], /ADD COLUMN sede/);
  assert.match(executed[1], /ADD CONSTRAINT fk_bodega_mov_origen/);
});

test("una colision de nombre de llave foranea distinta detiene la migracion", async () => {
  const statement = "ALTER TABLE bodega_movimientos ADD CONSTRAINT fk_bodega_mov_origen FOREIGN KEY (movimiento_origen_id) REFERENCES bodega_movimientos(id)";
  await assert.rejects(() => executeMigrationStatement(async () => {
    throw Object.assign(new Error("duplicate foreign key constraint name"), { code: "ER_FK_DUP_NAME" });
  }, statement, {
    isDuplicateForeignKeyAlreadyApplied: async () => false
  }), { code: "ER_FK_DUP_NAME" });
});

test("solo reconoce definiciones de llave foranea de una columna completas", () => {
  assert.deepEqual(parseSingleColumnForeignKey(
    "ALTER TABLE `bodega_movimientos` ADD CONSTRAINT `fk_origen` FOREIGN KEY (`movimiento_origen_id`) REFERENCES `bodega_movimientos` (`id`)"
  ), {
    table: "bodega_movimientos",
    constraint: "fk_origen",
    column: "movimiento_origen_id",
    referencedTable: "bodega_movimientos",
    referencedColumn: "id"
  });
  assert.equal(parseSingleColumnForeignKey(
    "ALTER TABLE tabla ADD CONSTRAINT fk FOREIGN KEY (a, b) REFERENCES otra (a, b)"
  ), null);
});

test("no altera consultas ni sentencias que no sean ALTER TABLE", () => {
  const statement = "SELECT 'ALTER TABLE x ADD COLUMN y', COUNT(*) FROM tabla";
  assert.deepEqual(splitAlterTableStatement(statement), [statement]);
});

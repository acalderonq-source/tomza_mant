const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const ExcelJS = require("exceljs");
const { leerPersonal, PERFILES } = require("../src/scripts/importTallerCedulas");

async function archivoTemporal(rows) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "tomza-cedulas-"));
  const file = path.join(directory, "personal.xlsx");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Personal");
  sheet.getRow(1).values = ["COD TRAB", "Apellidos y Nombre", "ACTIVO", "Cédula", "Perfil"];
  rows.forEach(row => sheet.addRow(row));
  await workbook.xlsx.writeFile(file);
  return { directory, file };
}

test("importación lee solo personas activas y admite cédulas con formato", async () => {
  const temp = await archivoTemporal([
    [123, "Persona Uno", "SI", "1-2345-6789", "MECANICO"],
    [124, "Persona Dos", "NO", "2-1234-5678", "MECANICO"]
  ]);
  try {
    const people = await leerPersonal(temp.file);
    assert.equal(people.length, 1);
    assert.equal(people[0].cedula, "123456789");
    assert.deepEqual(people[0].targets, ["mecanico"]);
  } finally {
    await fs.rm(temp.directory, { recursive: true, force: true });
  }
});

test("importación reconoce el acceso de Enderezado en ambos perfiles sin duplicar personas", async () => {
  assert.deepEqual(PERFILES["ENDEREZADO Y PINTURA"], ["mecanico", "pesados"]);
});

test("importación detiene una cédula duplicada en la planilla", async () => {
  const temp = await archivoTemporal([
    [123, "Persona Uno", "SI", "1-2345-6789", "MECANICO"],
    [124, "Persona Dos", "SI", "123456789", "MECANICO"]
  ]);
  try {
    await assert.rejects(leerPersonal(temp.file), /cédula repetida/);
  } finally {
    await fs.rm(temp.directory, { recursive: true, force: true });
  }
});

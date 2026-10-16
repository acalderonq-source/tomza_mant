const ExcelJS = require('exceljs');

function crearLibroProveedores(proveedores) {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Gas Tomza';
  const hoja = libro.addWorksheet('Proveedores Taller', { views: [{ state: 'frozen', ySplit: 1 }] });
  hoja.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Proveedor', key: 'nombre', width: 48 },
    { header: 'Cedula juridica', key: 'cedula_juridica', width: 22 },
    { header: 'Contacto', key: 'contacto', width: 32 },
    { header: 'Telefono', key: 'telefono', width: 22 },
    { header: 'Correo electronico', key: 'email', width: 40 },
    { header: 'Direccion', key: 'direccion', width: 65 }
  ];
  for (const proveedor of proveedores) {
    const fila = {};
    for (const columna of hoja.columns) {
      fila[columna.key] = columna.key === 'id' ? proveedor.id : String(proveedor[columna.key] ?? '');
    }
    hoja.addRow(fila).alignment = { vertical: 'top', wrapText: true };
  }
  hoja.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hoja.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF123872' } };
  hoja.getRow(1).height = 26;
  hoja.autoFilter = { from: 'A1', to: 'G' + Math.max(1, hoja.rowCount) };
  for (const columna of ['cedula_juridica', 'telefono']) hoja.getColumn(columna).numFmt = '@';
  return libro;
}

module.exports = { crearLibroProveedores };

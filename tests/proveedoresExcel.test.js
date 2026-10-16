const test = require('node:test');
const assert = require('node:assert/strict');
const ExcelJS = require('exceljs');
const { crearLibroProveedores } = require('../src/utils/proveedoresExcel');
const pool = require('../src/db');
const router = require('../src/routes/compras.routes');

test('Excel conserva informacion de contacto como texto sin formulas', async () => {
  const libro = crearLibroProveedores([{id:1,nombre:'Proveedor',cedula_juridica:'0012345678',telefono:'00012345',contacto:'=SUM(A1)',email:null,direccion:'Direccion de prueba'}]);
  const recibido = new ExcelJS.Workbook();
  await recibido.xlsx.load(await libro.xlsx.writeBuffer());
  const hoja = recibido.worksheets[0];
  assert.equal(hoja.getCell('C2').value,'0012345678');
  assert.equal(hoja.getCell('D2').value,'=SUM(A1)');
  assert.equal(hoja.getCell('E2').value,'00012345');
  assert.equal(hoja.getCell('G2').value,'Direccion de prueba');
  assert.equal(hoja.views[0].ySplit,1);
  assert.equal(crearLibroProveedores([]).worksheets[0].rowCount,1);
});

test('descarga solo permite los mismos perfiles que el directorio', async () => {
  const route = router.stack.find(l=>l.route?.path==='/proveedores/excel').route;
  const original = pool.query;
  let consultas=0;
  pool.query=async()=>{consultas++;return [[]];};
  try {
    for(const rol of ['ADMIN','PROVEEDURIA_TALLER','MECANICO','CONTABILIDAD']) {
      let estado=200, contenido;
      const req={session:{user:{rol}}};
      const res={status(s){estado=s;return this;},send(v){contenido=v;},set(){},attachment(){},type(){},redirect(){estado=302;}};
      const antes=consultas;
      for(const layer of route.stack){let seguir=false;await layer.handle(req,res,()=>{seguir=true;});if(!seguir)break;}
      if(['ADMIN','PROVEEDURIA_TALLER'].includes(rol)) {assert.equal(estado,200);assert.ok(Buffer.isBuffer(contenido));}
      else {assert.equal(estado,403);assert.equal(consultas,antes);}
    }
  } finally {pool.query=original;}
});

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const ExcelJS = require('exceljs');
const ejs = require('ejs');
const personal = require('../src/utils/personalRh');

async function excel(filas, titulos = ['COD TRAB', 'Apellidos y Nombre']) {
  const libro = new ExcelJS.Workbook();
  const hoja = libro.addWorksheet('Hoja1');
  hoja.addRow(titulos);
  filas.forEach(f => hoja.addRow(f));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

test('lee el Excel con COD TRAB y Apellidos y Nombre', async () => {
  const personas = await personal.leerExcel(await excel([[1001, '  Pérez   Mora Ana '], [8, 'Solís Rojas Luis'], [null, null]]));
  assert.deepEqual(personas, [{ codigo: '1001', nombre: 'Pérez Mora Ana' }, { codigo: '8', nombre: 'Solís Rojas Luis' }]);
});

test('rechaza archivos con códigos repetidos, inválidos o sin columnas', async () => {
  await assert.rejects(personal.leerExcel(await excel([[1, 'A'], [1, 'B']])), /repetido/);
  await assert.rejects(personal.leerExcel(await excel([['X1', 'A']])), /código inválido/);
  await assert.rejects(personal.leerExcel(await excel([[1, 'A']], ['Numero', 'Persona'])), /No se encontraron las columnas/);
  await assert.rejects(personal.leerExcel(Buffer.from('no es excel')), /Excel/);
});

function poolFalso(actuales) {
  const escritos = [], desactivados = [];
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {},
    query: async (sql, params) => {
      if (sql.startsWith('SELECT codigo, nombre, activo')) return [actuales];
      if (sql.startsWith('INSERT INTO rh_personal')) { escritos.push(params.slice(1, 3)); return [{}]; }
      if (sql.startsWith('UPDATE rh_personal SET activo = 0')) { desactivados.push(...params.slice(2)); return [{}]; }
      throw new Error(sql);
    }
  };
  return { pool: { getConnection: async () => conn }, escritos, desactivados };
}

test('agrega nuevos, actualiza nombres y conserva a quien no viene salvo que se pida', async () => {
  const actuales = [{ codigo: '1', nombre: 'Uno', activo: 1 }, { codigo: '2', nombre: 'Dos', activo: 1 }, { codigo: '3', nombre: 'Tres', activo: 1 }];
  const archivo = [{ codigo: '1', nombre: 'Uno' }, { codigo: '2', nombre: 'Dos Corregido' }, { codigo: '4', nombre: 'Cuatro' }];
  const a = poolFalso(actuales);
  assert.deepEqual(await personal.importar(a.pool, archivo, 9), { total: 3, nuevos: 1, actualizados: 1, sinCambios: 1, ausentes: 1, desactivados: 0 });
  assert.deepEqual(a.escritos, [['2', 'Dos Corregido'], ['4', 'Cuatro']]);
  assert.deepEqual(a.desactivados, []);
  const b = poolFalso(actuales);
  assert.equal((await personal.importar(b.pool, archivo, 9, { desactivarAusentes: true })).desactivados, 1);
  assert.deepEqual(b.desactivados, ['3']);
});

test('la lista muestra el código, el nombre y si tiene acceso al sistema', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/recursos_humanos_personal.ejs'), {
    user: { nombre: 'RH' }, filtros: { q: '', estado: 'activos' }, totales: { activos: 2, inactivos: 0 },
    personas: [{ codigo: '1001', nombre: 'Pérez Mora Ana', activo: 1, conAcceso: true }, { codigo: '8', nombre: 'Solís Rojas Luis', activo: 1, conAcceso: false }]
  });
  assert.match(html, /Personal Gas Tomza/);
  assert.match(html, /1001/);
  assert.match(html, /Con acceso/);
  assert.match(html, /Sin acceso/);
});

test('el inicio de Recursos Humanos muestra el nodo Personal Gas Tomza', async () => {
  const html = await ejs.renderFile(path.join(__dirname, '../src/views/recursos_humanos.ejs'), { user: { nombre: 'RH', sede: 'Cartago' }, totalPersonal: 549 });
  assert.match(html, /href="\/recursos-humanos\/personal"/);
  assert.match(html, /549 personas activas/);
});

test('solo Recursos Humanos o ADMIN pueden abrir el personal', async () => {
  const router = require('../src/routes/recursosHumanos.routes');
  const guardia = router.stack[0].handle;
  const probar = user => new Promise(resolve => {
    const res = { status: c => ({ send: () => resolve(c) }), redirect: () => resolve(302), set() {} };
    guardia({ session: { user } }, res, () => resolve(200));
  });
  assert.equal(await probar({ rol: 'RH_GESTOR', departamentoActivo: 'RECURSOS_HUMANOS', departamentos: ['RECURSOS_HUMANOS'] }), 200);
  assert.equal(await probar({ rol: 'CONTABILIDAD', departamentoActivo: 'CONTABILIDAD', departamentos: ['CONTABILIDAD'] }), 403);
  assert.equal(await probar(null), 302);
});

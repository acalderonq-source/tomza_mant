const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SEDES_SOLICITUD, sedeSolicitud } = require('../src/utils/sedesSolicitudesTrabajadores');
const { validarSolicitud } = require('../src/routes/trabajadorSolicitudes.routes');

test('agrupa sedes generales sin exponer divisiones de Taller en el ingreso', () => {
  for (const sede of ['Cartago','granel_cartago','Granel','Taller','Técnicos']) assert.equal(sedeSolicitud(sede),'Cartago');
  for (const [origen,destino] of [['granel_alajuela','Alajuela'],['granel_guapiles','Guapiles'],['granel_la_cruz','La Cruz'],['granel_perez_zeledon','Perez Zeledon'],['generales-limon','Limon'],['mueble-limon','Limon'],['Recope_Limon','Limon']]) assert.equal(sedeSolicitud(origen),destino);
  assert.ok(SEDES_SOLICITUD.includes('Cartago'));
  assert.ok(!SEDES_SOLICITUD.some(s=>s.startsWith('granel_')||['Taller','Tecnicos','generales-limon'].includes(s)));
  assert.equal(sedeSolicitud('Inventada'),null);
});
test('solicitud conserva solo datos publicos; codigo y permisos los asigna ADMIN', () => {
  const datos=validarSolicitud({cedula:'100000001',nombre_completo:'Persona de Prueba',puesto:'Asistente',sede:'granel_cartago',codigo_trabajador:'1234',pin:'1234',usuario_ids:['1']},SEDES_SOLICITUD);
  assert.deepEqual(Object.keys(datos).sort(),['cedula','nombre_completo','puesto','sede']);
  assert.equal(datos.sede,'Cartago');
});

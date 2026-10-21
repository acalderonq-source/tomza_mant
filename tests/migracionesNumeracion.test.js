const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

// Estos números repetidos ya están aplicados en producción con su nombre completo.
// No se renombran (se volverían a ejecutar); solo se impide que aparezcan nuevos.
const REPETIDOS_HISTORICOS = new Set([
  '202610130001', '202610130002', '202610130003', '202610130004',
  '202610140005', '202610170001', '202610190001'
]);

test('las migraciones nuevas no repiten fecha y número', () => {
  const archivos = fs.readdirSync(path.join(__dirname, '..', 'migrations')).filter(f => f.endsWith('.sql'));
  const porNumero = new Map();
  for (const archivo of archivos) {
    const numero = archivo.split('_')[0];
    assert.match(numero, /^\d{12}$/, `Nombre inválido: ${archivo}`);
    porNumero.set(numero, [...(porNumero.get(numero) || []), archivo]);
  }
  const nuevos = [...porNumero].filter(([numero, lista]) => lista.length > 1 && !REPETIDOS_HISTORICOS.has(numero));
  assert.deepEqual(nuevos, [], 'Use el siguiente número libre del día para la nueva migración.');
});

test('el aplicador de migraciones bloquea ejecuciones simultáneas y registra fallos', () => {
  const fuente = fs.readFileSync(path.join(__dirname, '..', 'src', 'scripts', 'runMigrations.js'), 'utf8');
  assert.match(fuente, /GET_LOCK/);
  assert.match(fuente, /RELEASE_LOCK/);
  assert.match(fuente, /schema_migrations_fallidas/);
});

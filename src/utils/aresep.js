const crypto = require('node:crypto');

const tipos = { 1: 'Por mayor', 2: 'Cilindreros', 3: 'Granel', 4: 'Por mayor y granel' };
const mediciones = { 1: 'Másico', 2: 'Volumétrico', 3: 'No aplica' };
const campo = (id, label, type = 'text', options = {}) => ({ id, label, type, ...options });
const grupo = (title, fields) => ({ title, fields });
const num = (id, label, options) => campo(id, label, 'number', options);
const entero = (id, label, options) => campo(id, label, 'integer', options);
const fecha = (id, label, options) => campo(id, label, 'date', options);
const secciones = {
  unidades: {
    title: 'Unidades A7', unidad: true, columns: ['placa', 'almacenamiento', 'marca', 'anio', 'codigo_cr'],
    groups: [grupo('Identificación del transporte', [
      campo('activo', 'Número de activo'), campo('almacenamiento', 'Almacenamiento / sede'),
      campo('codigo_cr', 'Código CR'), campo('placa', 'Placa', 'text', { readonly: true }),
      campo('tipo_transporte', 'Tipo de transporte', 'select', { choices: tipos }),
      campo('medicion', 'Sistema de medición', 'select', { choices: mediciones }),
      campo('serie_medidor', 'Número de serie del medidor', 'text', { optional: true }),
      campo('marca', 'Marca'), num('peso_maximo', 'Peso máximo autorizado (kg)'),
      num('potencia', 'Capacidad de motor (HP)'), entero('llantas', 'Cantidad de llantas'),
      entero('anio', 'Año del vehículo', { min: 1900, max: 2100 })
    ])]
  },
  operacion: {
    title: 'Operación y costos', unidad: true, columns: ['placa', 'ruta', 'km_mes', 'litros_vendidos', 'monto_facturado', 'depreciacion_mensual'],
    groups: [
      grupo('Ruta y actividad comercial', [campo('ruta', 'Ruta', 'text', { required: true }),
        campo('placa', 'Id camión / placa', 'text', { readonly: true }), campo('tipo', 'Tipo'),
        entero('rutas_mes', 'Rutas al mes'), entero('llantas', 'Cantidad de llantas'),
        num('carga_tecnica', 'Capacidad de carga técnica'), num('carga_comercial', 'Capacidad de carga comercial'),
        entero('clientes_ruta', 'Clientes en ruta'), entero('facturas', 'Cantidad de ventas / facturas'),
        entero('clientes_venta', 'Clientes con venta'), num('litros_vendidos', 'Litros vendidos'), num('monto_facturado', 'Monto facturado (CRC)')]),
      grupo('Activo y recorrido', [num('valor_unidad', 'Valor de la unidad (CRC)'), fecha('fecha_compra', 'Fecha de compra'),
        num('vida_util', 'Vida útil (años)'), num('valor_libros', 'Valor en libros (CRC)'), num('km_mes', 'Kilómetros recorridos en el mes'),
        num('depreciacion_mensual', 'Depreciación mensual (CRC)'),
        campo('rutas_detalle', 'Rutas del mes'), campo('definicion', 'Definición / unidad de medida de carga')]),
      grupo('Combustible y llantas', [num('combustible', 'Combustible usado (litros)'), num('precio_combustible', 'Precio promedio por litro (CRC)'),
        entero('llantas_camion', 'Cantidad de llantas por camión'), num('km_llantas', 'Kilómetros entre cambio de llantas'), num('precio_llanta', 'Costo por llanta (CRC)')]),
      grupo('Lubricación, lavado y engrase', [campo('lubricante', 'Tipo de lubricante'), num('cantidad_lubricante', 'Lubricante por camión (litros)'),
        num('precio_estanon', 'Precio de lubricante por estañón (CRC)'), num('km_lubricante', 'Kilómetros entre cambios de lubricante'),
        campo('periodicidad_aceite', 'Periodicidad del cambio de aceite'), entero('cambios_mes', 'Cambios de aceite al mes'),
        campo('periodicidad_lavado', 'Periodicidad de lavado'), num('costo_lavado', 'Costo por lavado (CRC)'), entero('lavados_mes', 'Lavados al mes'),
        campo('periodicidad_engrase', 'Periodicidad de engrase'), num('costo_cubeta', 'Costo de cubeta (CRC)'), num('litros_engrase', 'Litros por engrase')]),
      grupo('Mantenimiento y reparaciones', [entero('mantenimientos', 'Cantidad de mantenimientos'), entero('alineamientos', 'Cantidad de alineamientos'),
        entero('afinamientos', 'Cantidad de afinamientos'), entero('frenos', 'Cantidad de revisiones / cambios de frenos'),
        num('costo_mantenimiento', 'Costo por mantenimiento (CRC)'), num('costo_alineamiento', 'Costo por alineamiento (CRC)'),
        num('costo_afinamiento', 'Costo por afinamiento (CRC)'), num('costo_frenos', 'Costo por revisión de frenos (CRC)')]),
      grupo('Peajes, permisos y seguros', [campo('requiere_peaje', '¿La ruta requiere peaje?', 'select', { choices: { SI: 'Sí', NO: 'No' } }),
        entero('peajes_ruta', 'Cantidad de peajes por ruta'), num('costo_peaje', 'Costo de peajes por ruta (CRC)'),
        num('marchamo', 'Monto de marchamo del año (CRC)'), num('dekra', 'Monto DEKRA del año (CRC)'),
        num('seguro', 'Monto de seguro (CRC)'), campo('periodicidad_seguro', 'Periodicidad del seguro')])
    ]
  },
  planilla: {
    title: 'Planilla', privada: true, columns: ['nombre', 'identificacion', 'puesto', 'salario_reportado', 'neto'],
    groups: [grupo('Persona y puesto', [campo('nombre', 'Nombre', 'text', { required: true }),
      campo('identificacion', 'Identificación', 'text', { required: true }), fecha('fecha_ingreso', 'Fecha de ingreso'), campo('puesto', 'Puesto')]),
    grupo('Montos del mes', [num('salario_base', 'Salario base (CRC)'), num('comision', 'Comisión (CRC)'),
      num('salario_reportado', 'Salario reportado (CRC)'), num('tasa_ccss', 'Deducción CCSS (%)', { max: 100 }),
      entero('dias_laborados', 'Días laborados', { max: 31 }), entero('dias_incapacidad', 'Días de incapacidad', { max: 31 })])]
  },
  ventas: {
    title: 'Litros vendidos', columns: ['litros', 'ruta', 'planta', 'diferencia'],
    groups: [grupo('Consolidado mensual', [num('litros', 'Total de litros vendidos'), num('ruta', 'Litros vendidos en ruta'), num('planta', 'Litros vendidos en planta')])]
  },
  rutas: {
    title: 'Litros por ruta', columns: ['fecha', 'bodega', 'producto', 'cilindros', 'litros'],
    groups: [grupo('Producto entregado', [fecha('fecha', 'Fecha', { required: true }), campo('bodega', 'Bodega / ruta', 'text', { required: true }),
      campo('producto', 'Código de producto', 'text', { required: true }), entero('cilindros', 'Cantidad de cilindros'), num('litros', 'Total de litros')])]
  }
};
const extras = { neto: 'Ingreso neto (CRC)', diferencia: 'Diferencia de litros' };
function campos(seccion) { return secciones[seccion].groups.flatMap(g => g.fields); }
function permitidas(user) {
  if (!['ADMIN', 'CONTABILIDAD', 'TRAMITES'].includes(user?.rol) || /^mecanicos?/i.test(user?.usuario || '')) return [];
  return Object.keys(secciones).filter(k => !secciones[k].privada || ['ADMIN', 'CONTABILIDAD'].includes(user.rol));
}
function mesActual() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit' }).formatToParts(new Date());
  return `${parts.find(p => p.type === 'year').value}-${parts.find(p => p.type === 'month').value}`;
}
function periodoValido(p) { return typeof p === 'string' && /^(20\d{2})-(0[1-9]|1[0-2])$/.test(p); }
function texto(value) { return typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''; }
function fechaValida(s) { return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(`${s}T12:00:00Z`).toISOString().slice(0, 10) === s; }
function validar(seccion, body, periodo, unidad) {
  if (!Object.hasOwn(secciones, seccion) || !periodoValido(periodo)) throw new Error('Seleccione un apartado y un mes válidos.');
  if (secciones[seccion].unidad && !unidad) throw new Error('Seleccione una unidad registrada.');
  const datos = {};
  if (!secciones[seccion].unidad) {
    const sede = texto(body.sede);
    if (!sede || sede.length > 100) throw new Error('Seleccione una sede válida.');
    datos.sede = sede;
  } else if (seccion === 'operacion') {
    datos.sede = texto(body.sede) || texto(unidad.sede);
  }
  for (const f of campos(seccion)) {
    const raw = f.id === 'placa' ? unidad.placa : texto(body[f.id]);
    if (!raw) {
      if (f.required) throw new Error(`Complete: ${f.label}.`);
      datos[f.id] = null;
      continue;
    }
    if (f.type === 'number' || f.type === 'integer') {
      if (!/^\d+(?:[.,]\d{1,2})?$/.test(raw)) throw new Error(`${f.label}: use un número positivo, sin separadores de miles y con hasta 2 decimales.`);
      const value = Number(raw.replace(',', '.'));
      if (!Number.isFinite(value) || value < (f.min ?? 0) || value > (f.max ?? 999999999999.99) || (f.type === 'integer' && !Number.isInteger(value))) throw new Error(`${f.label}: valor fuera de rango.`);
      datos[f.id] = value;
    } else if (f.type === 'select') {
      if (!Object.hasOwn(f.choices, raw)) throw new Error(`${f.label}: opción inválida.`);
      datos[f.id] = raw;
    } else if (f.type === 'date') {
      if (!fechaValida(raw)) throw new Error(`${f.label}: fecha inválida.`);
      datos[f.id] = raw;
    } else {
      if (raw.length > 250) throw new Error(`${f.label}: máximo 250 caracteres.`);
      datos[f.id] = raw;
    }
  }
  if (seccion === 'rutas' && datos.fecha.slice(0, 7) !== periodo) throw new Error('La fecha debe pertenecer al mes seleccionado.');
  if (seccion === 'planilla' && (datos.dias_laborados || 0) + (datos.dias_incapacidad || 0) > new Date(Number(periodo.slice(0, 4)), Number(periodo.slice(5)), 0).getDate()) throw new Error('Los días laborados e incapacitados superan los días del mes.');
  datos.observacion = texto(body.observacion);
  if (datos.observacion.length > 2000) throw new Error('La observación admite hasta 2000 caracteres.');
  return datos;
}
function pendientes(seccion, datos) {
  const faltantes = campos(seccion).filter(f => !f.optional && (datos[f.id] === null || datos[f.id] === undefined || datos[f.id] === '')).map(f => f.label);
  if (!secciones[seccion].unidad && !datos.sede) faltantes.unshift('Sede');
  return faltantes;
}
function clave(seccion, d, unidadId) {
  const keys = { unidades: [unidadId], operacion: [unidadId, d.ruta], planilla: [d.identificacion], ventas: [d.sede], rutas: [d.sede, d.fecha, d.bodega, d.producto] };
  const values = keys[seccion].map(v => String(v).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase());
  return crypto.createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
function derivados(seccion, d) {
  const completo = keys => keys.every(k => d[k] !== null && d[k] !== undefined && d[k] !== '');
  const round = n => Math.round((n + Number.EPSILON) * 100) / 100;
  if (seccion === 'planilla') {
    const ccss = completo(['salario_reportado', 'tasa_ccss']) ? round(d.salario_reportado * d.tasa_ccss / 100) : null;
    return { base_comision: completo(['salario_base', 'comision']) ? round(d.salario_base + d.comision) : null, ccss, neto: ccss === null ? null : round(d.salario_reportado - ccss) };
  }
  if (seccion === 'ventas') return { diferencia: completo(['litros', 'ruta', 'planta']) ? round(d.litros - d.ruta - d.planta) : null };
  return {};
}
function leerDatos(record) { return typeof record.datos === 'string' ? JSON.parse(record.datos) : record.datos; }
function sedeRegistro(record, unidadesPorId = new Map()) {
  const datos = leerDatos(record);
  if (record.seccion === 'unidades') return texto(datos.almacenamiento) || texto(record.sede) || texto(unidadesPorId.get(record.unidad_id));
  if (record.seccion === 'operacion') return texto(datos.sede) || texto(record.sede) || texto(unidadesPorId.get(record.unidad_id));
  return texto(datos.sede);
}
function preparar(record) {
  const datos = leerDatos(record);
  return { ...record, datos, valores: { ...datos, ...derivados(record.seccion, datos) }, pendientes: pendientes(record.seccion, datos) };
}
function mostrar(seccion, key, value) {
  if (value === null || value === undefined || value === '') return 'Pendiente';
  if (key === 'anio') return String(value);
  const f = campos(seccion).find(c => c.id === key);
  if (f?.choices) return f.choices[value] || value;
  return typeof value === 'number' ? value.toLocaleString('es-CR', { maximumFractionDigits: 2 }) : value;
}
module.exports = { secciones, tipos, mediciones, campos, permitidas, mesActual, periodoValido, validar, pendientes, clave, derivados, leerDatos, preparar, mostrar, sedeRegistro, extras };

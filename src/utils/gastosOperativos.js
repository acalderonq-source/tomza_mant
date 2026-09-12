const pool = require("../db");
const { normalizarPlaca } = require("./placas");

const TIPOS_TRABAJO = new Set(["CORRECTIVO", "PREVENTIVO", "SUMINISTROS", "MANTENIMIENTO", "REPARACION", "EMERGENCIA", "OTRO"]);

function limpiar(value) {
  return String(value || "").trim();
}

function upper(value) {
  return limpiar(value).toUpperCase();
}

function fechaIso(value = new Date()) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Costa_Rica",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(value);
  }
  const texto = limpiar(value);
  return /^\d{4}-\d{2}-\d{2}/.test(texto) ? texto.slice(0, 10) : fechaIso(new Date());
}

function periodoDesdeFecha(fecha) {
  return fechaIso(fecha).slice(0, 7);
}

function normalizarTipoTrabajo(value) {
  const tipo = upper(value);
  if (tipo === "MANTENIMIENTO" || tipo === "REPARACION" || tipo === "EMERGENCIA") return "CORRECTIVO";
  return TIPOS_TRABAJO.has(tipo) ? tipo : "CORRECTIVO";
}

function clasificarRubroBasico(texto) {
  const normalizado = limpiar(texto)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  const reglas = [
    ["Frenos", ["freno", "fibra", "friccion", "tambor", "zapata", "disco", "tanque de vacio", "juego de mano"]],
    ["Llantas", ["llanta", "aro", "rin", "neumatico"]],
    ["Transmisión y tren motriz", ["transmision", "clutch", "diferencial", "cruceta", "cardan", "yugo"]],
    ["Eléctrico y luces", ["luz", "luces", "bateria", "alternador", "arrancador", "cable", "sensor", "modulo", "switch", "fusible"]],
    ["Suspensión y dirección", ["suspension", "direccion", "resorte", "amortiguador", "rotula", "pin", "muelle", "buje"]],
    ["Aceites y fluidos", ["aceite", "hidraulico", "coolant", "grasa", "varsol", "desengrasante"]],
    ["Rodamientos y retenes", ["roll", "rodamiento", "reten", "retenedor", "bocina", "sello"]],
    ["Carrocería y estética", ["carroceria", "cabina", "puerta", "bumper", "pintura", "espejo", "grada", "escobilla", "limpiador"]]
  ];

  const encontrada = reglas.find(([, palabras]) => palabras.some(palabra => normalizado.includes(palabra)));
  return encontrada ? encontrada[0] : "Sin clasificar";
}

function clasificarNegocioBasico({ placa, sede, descripcion }) {
  const texto = `${placa || ""} ${sede || ""} ${descripcion || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const placaLimpia = upper(placa).replace(/[^A-Z0-9]/g, "");

  if (placaLimpia === "ACEITES" || texto.includes("estanon") || texto.includes("aceite 55")) return "Aceites";
  if (texto.includes("granel")) return "Graneleras";
  if (/^S\d{5,6}$/.test(placaLimpia) || texto.includes("transportadora") || texto.includes("cabezal") || texto.includes("cisterna") || texto.includes("carreta") || texto.includes("tandem") || texto.includes("tamden")) {
    return "Transportadora";
  }
  if (/^EE\d{5,6}$/.test(placaLimpia) || texto.includes("tecnico") || texto.includes("taller")) return "Comodines";
  if (/^(C|CL)\d{5,6}$/.test(placaLimpia)) return "Hinos / cilindreros";
  return "Sin asignar";
}

async function ensureGastosOperativosTables(conn = pool) {
  await conn.query(`
    CREATE TABLE IF NOT EXISTS gastos_operativos (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      fuente VARCHAR(40) NOT NULL,
      fuente_id BIGINT NOT NULL,
      detalle_id BIGINT NOT NULL DEFAULT 0,
      fecha DATE NOT NULL,
      periodo CHAR(7) NOT NULL,
      placa VARCHAR(50) NULL,
      sede VARCHAR(120) NULL,
      negocio VARCHAR(80) NULL,
      tipo_unidad VARCHAR(80) NULL,
      rubro VARCHAR(80) NOT NULL,
      tipo_trabajo VARCHAR(30) NOT NULL DEFAULT 'CORRECTIVO',
      proveedor VARCHAR(180) NULL,
      descripcion TEXT NULL,
      cantidad DECIMAL(14,4) NOT NULL DEFAULT 1,
      precio_unitario DECIMAL(14,4) NOT NULL DEFAULT 0,
      monto DECIMAL(14,4) NOT NULL DEFAULT 0,
      estado VARCHAR(40) NOT NULL DEFAULT 'ACTIVO',
      creado_por INT NULL,
      metadata JSON NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_gastos_operativos_fuente (fuente, fuente_id, detalle_id),
      INDEX idx_gastos_operativos_periodo (periodo),
      INDEX idx_gastos_operativos_fecha (fecha),
      INDEX idx_gastos_operativos_placa (placa),
      INDEX idx_gastos_operativos_sede (sede),
      INDEX idx_gastos_operativos_negocio (negocio),
      INDEX idx_gastos_operativos_rubro (rubro),
      INDEX idx_gastos_operativos_tipo_trabajo (tipo_trabajo),
      INDEX idx_gastos_operativos_estado (estado)
    )
  `);

  await conn.query(`
    CREATE TABLE IF NOT EXISTS auditoria_sistema (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      modulo VARCHAR(80) NOT NULL,
      tabla_afectada VARCHAR(80) NOT NULL,
      registro_id BIGINT NULL,
      accion VARCHAR(40) NOT NULL,
      resumen VARCHAR(255) NULL,
      antes JSON NULL,
      despues JSON NULL,
      usuario_id INT NULL,
      usuario_nombre VARCHAR(120) NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_auditoria_modulo_fecha (modulo, creado_en),
      INDEX idx_auditoria_tabla_registro (tabla_afectada, registro_id),
      INDEX idx_auditoria_usuario (usuario_id)
    )
  `);
}

async function registrarGastoOperativo(gasto, conn = pool, options = {}) {
  if (options.ensure !== false) {
    await ensureGastosOperativosTables(conn);
  }

  const fecha = fechaIso(gasto.fecha);
  const cantidad = Number(gasto.cantidad || 1);
  const precioUnitario = Number(gasto.precio_unitario || gasto.precioUnitario || 0);
  const monto = Number(gasto.monto ?? (cantidad * precioUnitario));
  const placa = normalizarPlaca(gasto.placa) || upper(gasto.placa) || null;
  const descripcion = limpiar(gasto.descripcion);
  const rubro = limpiar(gasto.rubro) || clasificarRubroBasico(`${descripcion} ${gasto.categoria || ""}`);
  const negocio = limpiar(gasto.negocio) || clasificarNegocioBasico({ placa, sede: gasto.sede, descripcion });

  await conn.query(
    `INSERT INTO gastos_operativos (
       fuente, fuente_id, detalle_id, fecha, periodo, placa, sede, negocio, tipo_unidad,
       rubro, tipo_trabajo, proveedor, descripcion, cantidad, precio_unitario, monto,
       estado, creado_por, metadata
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       fecha = VALUES(fecha),
       periodo = VALUES(periodo),
       placa = VALUES(placa),
       sede = VALUES(sede),
       negocio = VALUES(negocio),
       tipo_unidad = VALUES(tipo_unidad),
       rubro = VALUES(rubro),
       tipo_trabajo = VALUES(tipo_trabajo),
       proveedor = VALUES(proveedor),
       descripcion = VALUES(descripcion),
       cantidad = VALUES(cantidad),
       precio_unitario = VALUES(precio_unitario),
       monto = VALUES(monto),
       estado = VALUES(estado),
       creado_por = VALUES(creado_por),
       metadata = VALUES(metadata)`,
    [
      upper(gasto.fuente),
      Number(gasto.fuente_id || gasto.fuenteId || 0),
      Number(gasto.detalle_id || gasto.detalleId || 0),
      fecha,
      limpiar(gasto.periodo) || periodoDesdeFecha(fecha),
      placa,
      limpiar(gasto.sede) || null,
      negocio,
      limpiar(gasto.tipo_unidad || gasto.tipoUnidad) || null,
      rubro,
      normalizarTipoTrabajo(gasto.tipo_trabajo || gasto.tipoTrabajo),
      limpiar(gasto.proveedor) || null,
      descripcion || null,
      cantidad,
      precioUnitario,
      monto,
      upper(gasto.estado) || "ACTIVO",
      gasto.creado_por || gasto.creadoPor || null,
      JSON.stringify(gasto.metadata || {})
    ]
  );
}

async function registrarAuditoriaSistema(auditoria, conn = pool, options = {}) {
  if (options.ensure !== false) {
    await ensureGastosOperativosTables(conn);
  }

  await conn.query(
    `INSERT INTO auditoria_sistema (
       modulo, tabla_afectada, registro_id, accion, resumen, antes, despues, usuario_id, usuario_nombre
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      limpiar(auditoria.modulo),
      limpiar(auditoria.tabla_afectada || auditoria.tabla),
      auditoria.registro_id || auditoria.registroId || null,
      upper(auditoria.accion),
      limpiar(auditoria.resumen).slice(0, 255) || null,
      auditoria.antes ? JSON.stringify(auditoria.antes) : null,
      auditoria.despues ? JSON.stringify(auditoria.despues) : null,
      auditoria.usuario_id || auditoria.usuarioId || null,
      limpiar(auditoria.usuario_nombre || auditoria.usuarioNombre) || null
    ]
  );
}

module.exports = {
  clasificarNegocioBasico,
  clasificarRubroBasico,
  ensureGastosOperativosTables,
  registrarAuditoriaSistema,
  registrarGastoOperativo
};

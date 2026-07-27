const ESTADOS_REPUESTOS = [
  "PENDIENTE_COMPRAR",
  "PEDIDO",
  "EN_TRANSITO",
  "ENTREGADO"
];

const PRIORIDADES_REPUESTOS = ["BAJA", "MEDIA", "ALTA"];

function normalizarPlaca(value) {
  return String(value || "").trim().toUpperCase();
}

function normalizarEstado(value) {
  const estado = String(value || "").trim().toUpperCase();
  return ESTADOS_REPUESTOS.includes(estado) ? estado : "PENDIENTE_COMPRAR";
}

function normalizarPrioridad(value) {
  const prioridad = String(value || "").trim().toUpperCase();
  return PRIORIDADES_REPUESTOS.includes(prioridad) ? prioridad : "MEDIA";
}

function etiquetaEstadoRepuesto(value) {
  const estado = normalizarEstado(value);
  return {
    PENDIENTE_COMPRAR: "Pendiente de comprar",
    PEDIDO: "Pedido",
    EN_TRANSITO: "En tránsito",
    ENTREGADO: "Entregado"
  }[estado];
}

function etiquetaPrioridadRepuesto(value) {
  const prioridad = normalizarPrioridad(value);
  return {
    BAJA: "Baja",
    MEDIA: "Media",
    ALTA: "Alta"
  }[prioridad];
}

async function ensureRepuestosSolicitudesTable(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS solicitudes_repuestos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      fecha_solicitud DATE NOT NULL,
      sede VARCHAR(100) NOT NULL,
      placa VARCHAR(50) NOT NULL,
      solicitado_por VARCHAR(150) NOT NULL,
      repuesto_solicitado TEXT NOT NULL,
      cantidad DECIMAL(10,2) NOT NULL DEFAULT 1,
      prioridad ENUM('BAJA','MEDIA','ALTA') NOT NULL DEFAULT 'MEDIA',
      estado ENUM('PENDIENTE_COMPRAR','PEDIDO','EN_TRANSITO','ENTREGADO') NOT NULL DEFAULT 'PENDIENTE_COMPRAR',
      proveedor_id INT NULL,
      proveedor VARCHAR(180) NULL,
      creado_por INT NULL,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_repuestos_estado (estado),
      INDEX idx_repuestos_sede (sede),
      INDEX idx_repuestos_fecha (fecha_solicitud),
      INDEX idx_repuestos_placa (placa)
    )
  `);

  const [[proveedorIdColumn]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'solicitudes_repuestos'
       AND COLUMN_NAME = 'proveedor_id'`
  );

  if (!Number(proveedorIdColumn.count || 0)) {
    await pool.query("ALTER TABLE solicitudes_repuestos ADD COLUMN proveedor_id INT NULL AFTER estado");
  }
}

module.exports = {
  ESTADOS_REPUESTOS,
  PRIORIDADES_REPUESTOS,
  ensureRepuestosSolicitudesTable,
  etiquetaEstadoRepuesto,
  etiquetaPrioridadRepuesto,
  normalizarEstado,
  normalizarPlaca,
  normalizarPrioridad
};

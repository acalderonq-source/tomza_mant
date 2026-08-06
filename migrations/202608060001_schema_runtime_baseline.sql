-- Baseline de estructuras que antes se creaban desde rutas.
-- El runner ignora columnas/indices/tablas duplicadas para permitir correrlo en bases existentes.

CREATE TABLE IF NOT EXISTS push_subscriptions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  usuario_id INT NULL,
  usuario VARCHAR(100) NULL,
  rol VARCHAR(50) NULL,
  sede VARCHAR(100) NULL,
  endpoint TEXT NOT NULL,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_envio DATE NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_push_endpoint (endpoint(255)),
  INDEX idx_push_activo (activo),
  INDEX idx_push_sede (sede)
);

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
);

CREATE TABLE IF NOT EXISTS aires_acondicionados (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  sede VARCHAR(100) NOT NULL,
  tipo_trabajo ENUM('REPARACION','CARGA','MANTENIMIENTO') NOT NULL,
  fecha DATE NOT NULL,
  realizado_por VARCHAR(150) NOT NULL,
  proximo_mantenimiento DATE NULL,
  observaciones TEXT NULL,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aires_unidad_fecha (unidad_id, fecha),
  INDEX idx_aires_sede_fecha (sede, fecha),
  INDEX idx_aires_proximo (proximo_mantenimiento)
);

CREATE TABLE IF NOT EXISTS taller_prioridades (
  id INT AUTO_INCREMENT PRIMARY KEY,
  placa VARCHAR(50) NOT NULL,
  sede VARCHAR(80) NULL,
  fecha_prioridad DATE NULL,
  observacion TEXT NOT NULL,
  estado ENUM('PENDIENTE','ATENDIDA') NOT NULL DEFAULT 'PENDIENTE',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  atendido_por INT NULL,
  atendido_en DATETIME NULL,
  INDEX idx_taller_prioridades_estado (estado),
  INDEX idx_taller_prioridades_sede (sede),
  INDEX idx_taller_prioridades_fecha (fecha_prioridad),
  INDEX idx_taller_prioridades_creado (creado_en)
);

CREATE TABLE IF NOT EXISTS solicitudes_llantas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NULL,
  placa VARCHAR(50) NOT NULL,
  sede VARCHAR(100) NOT NULL,
  medida VARCHAR(100) NOT NULL,
  cantidad INT NOT NULL DEFAULT 1,
  posicion VARCHAR(100) NULL,
  marca_sugerida VARCHAR(100) NULL,
  motivo TEXT NULL,
  observaciones TEXT NULL,
  estado VARCHAR(30) NOT NULL DEFAULT 'SOLICITADA',
  proveedor VARCHAR(150) NULL,
  precio_unitario DECIMAL(12,2) NULL,
  monto_total DECIMAL(12,2) NULL,
  cotizacion_notas TEXT NULL,
  solicitado_por INT NULL,
  cotizado_por INT NULL,
  comprado_por INT NULL,
  recibido_por INT NULL,
  fecha_solicitud DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  fecha_cotizada DATETIME NULL,
  fecha_comprada DATETIME NULL,
  fecha_recibida DATETIME NULL,
  INDEX idx_sede_estado (sede, estado),
  INDEX idx_unidad (unidad_id),
  INDEX idx_fecha (fecha_solicitud)
);

CREATE TABLE IF NOT EXISTS solicitudes_llantas_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  solicitud_id INT NOT NULL,
  estado_anterior VARCHAR(30) NULL,
  estado_nuevo VARCHAR(30) NOT NULL,
  comentario TEXT NULL,
  usuario_id INT NULL,
  fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_solicitud (solicitud_id)
);

CREATE TABLE IF NOT EXISTS ordenes_motor (
  id INT AUTO_INCREMENT PRIMARY KEY,
  numero VARCHAR(30) NOT NULL UNIQUE,
  fecha DATE NOT NULL,
  proveedor_id INT NULL,
  placa_unidad VARCHAR(50) NULL,
  motor VARCHAR(100) NULL,
  forma_pago VARCHAR(100) NULL,
  moneda VARCHAR(10) NOT NULL DEFAULT 'CRC',
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  descuento DECIMAL(10,2) NOT NULL DEFAULT 0,
  transporte DECIMAL(14,2) NOT NULL DEFAULT 0,
  iva DECIMAL(14,2) NOT NULL DEFAULT 0,
  total DECIMAL(14,2) NOT NULL DEFAULT 0,
  observaciones TEXT NULL,
  cotizacion_archivo VARCHAR(255) NULL,
  cotizacion_nombre VARCHAR(255) NULL,
  cotizacion_tipo VARCHAR(100) NULL,
  empresa_destino VARCHAR(80) NOT NULL DEFAULT 'GAS TOMZA',
  estado VARCHAR(40) NOT NULL DEFAULT 'BORRADOR',
  creado_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_motor_fecha (fecha),
  INDEX idx_motor_estado (estado),
  INDEX idx_motor_placa (placa_unidad)
);

CREATE TABLE IF NOT EXISTS ordenes_motor_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  orden_motor_id INT NOT NULL,
  codigo VARCHAR(80) NULL,
  descripcion VARCHAR(255) NOT NULL,
  cantidad DECIMAL(12,2) NOT NULL DEFAULT 1,
  precio_unitario DECIMAL(14,2) NOT NULL DEFAULT 0,
  subtotal DECIMAL(14,2) NOT NULL DEFAULT 0,
  INDEX idx_motor_detalle_orden (orden_motor_id),
  CONSTRAINT fk_ordenes_motor_detalle
    FOREIGN KEY (orden_motor_id) REFERENCES ordenes_motor(id)
    ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS oficina_dia_dia (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  nombre_persona VARCHAR(150) NOT NULL,
  actividad TEXT NOT NULL,
  sede VARCHAR(100) NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_oficina_fecha (fecha),
  INDEX idx_oficina_sede (sede)
);

CREATE TABLE IF NOT EXISTS revisiones_ruta (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  sede VARCHAR(100) NOT NULL,
  fecha DATE NOT NULL,
  turno VARCHAR(50) NULL,
  kilometraje INT NULL,
  apto_ruta TINYINT(1) NOT NULL DEFAULT 1,
  observaciones_generales TEXT NULL,
  foto_nombre VARCHAR(255) NULL,
  foto_tipo VARCHAR(100) NULL,
  foto_base64 LONGTEXT NULL,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_revision_ruta_fecha (fecha),
  INDEX idx_revision_ruta_sede_fecha (sede, fecha),
  INDEX idx_revision_ruta_unidad_fecha (unidad_id, fecha)
);

CREATE TABLE IF NOT EXISTS revisiones_ruta_detalle (
  id INT AUTO_INCREMENT PRIMARY KEY,
  revision_id INT NOT NULL,
  item_clave VARCHAR(80) NOT NULL,
  item_nombre VARCHAR(150) NOT NULL,
  estado ENUM('BIEN','REGULAR','MAL','NO_APLICA') NOT NULL DEFAULT 'BIEN',
  observacion TEXT NULL,
  foto_nombre VARCHAR(255) NULL,
  foto_tipo VARCHAR(100) NULL,
  foto_base64 LONGTEXT NULL,
  INDEX idx_revision_ruta_detalle_revision (revision_id),
  INDEX idx_revision_ruta_detalle_estado (estado)
);

CREATE TABLE IF NOT EXISTS giras_taller (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sede VARCHAR(100) NOT NULL,
  fecha DATE NOT NULL,
  inspector VARCHAR(150) NOT NULL,
  estado ENUM('ABIERTA','EN_SEGUIMIENTO','CERRADA') NOT NULL DEFAULT 'ABIERTA',
  observaciones TEXT NOT NULL,
  pendientes TEXT NULL,
  acciones_recomendadas TEXT NULL,
  creado_por INT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_giras_sede_fecha (sede, fecha),
  INDEX idx_giras_estado (estado)
);

CREATE TABLE IF NOT EXISTS giras_taller_recomendaciones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  gira_id INT NOT NULL,
  sede VARCHAR(100) NOT NULL,
  placa VARCHAR(50) NOT NULL,
  recomendacion TEXT NULL,
  tema_mecanico TEXT NULL,
  tema_estetico TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_giras_rec_gira (gira_id),
  INDEX idx_giras_rec_sede_placa (sede, placa)
);

CREATE TABLE IF NOT EXISTS reportes_supervisores (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  sede VARCHAR(100) NOT NULL,
  supervisor_id INT NULL,
  supervisor_nombre VARCHAR(150) NULL,
  descripcion_original TEXT NOT NULL,
  descripcion_limpia TEXT NULL,
  nota_taller TEXT NULL,
  importante TINYINT(1) NOT NULL DEFAULT 0,
  estado ENUM('PENDIENTE','EN_REVISION','HISTORIAL','DESCARTADO') NOT NULL DEFAULT 'PENDIENTE',
  fecha_reporte DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NULL,
  cerrado_por INT NULL,
  fecha_cierre DATETIME NULL,
  correctivo_id INT NULL,
  cierre_motivo TEXT NULL,
  cierre_confianza DECIMAL(5,2) NULL,
  INDEX idx_reportes_estado_sede (estado, sede),
  INDEX idx_reportes_unidad_estado (unidad_id, estado),
  INDEX idx_reportes_correctivo (correctivo_id)
);

CREATE TABLE IF NOT EXISTS reportes_supervisores_sugerencias (
  id INT AUTO_INCREMENT PRIMARY KEY,
  reporte_id INT NOT NULL,
  correctivo_id INT NOT NULL,
  confianza DECIMAL(5,2) NOT NULL DEFAULT 0,
  motivo TEXT NULL,
  estado ENUM('PENDIENTE','CONFIRMADA','DESCARTADA') NOT NULL DEFAULT 'PENDIENTE',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resuelto_por INT NULL,
  resuelto_en DATETIME NULL,
  UNIQUE KEY uq_reporte_correctivo (reporte_id, correctivo_id),
  INDEX idx_sugerencias_estado (estado),
  INDEX idx_sugerencias_correctivo (correctivo_id)
);

ALTER TABLE unidades ADD COLUMN activa TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE unidades ADD COLUMN varada TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE unidades ADD COLUMN razon_varada TEXT NULL;

ALTER TABLE solicitudes_repuestos ADD COLUMN proveedor_id INT NULL AFTER estado;

ALTER TABLE taller_prioridades ADD COLUMN fecha_prioridad DATE NULL AFTER sede;
UPDATE taller_prioridades SET fecha_prioridad = DATE(creado_en) WHERE fecha_prioridad IS NULL;

ALTER TABLE ordenes_compra ADD COLUMN nota_credito_numero VARCHAR(100) NULL;
ALTER TABLE ordenes_compra ADD COLUMN nota_credito_fecha DATE NULL;
ALTER TABLE ordenes_compra ADD COLUMN nota_credito_monto DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_compra ADD COLUMN nota_credito_motivo TEXT NULL;
ALTER TABLE ordenes_compra ADD COLUMN abono_monto DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_compra ADD COLUMN abono_fecha DATE NULL;
ALTER TABLE ordenes_compra ADD COLUMN abono_observacion TEXT NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_fecha DATE NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_fecha_recepcion DATE NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_tipo_entrega VARCHAR(80) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_entregado_por VARCHAR(150) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_recibido_por VARCHAR(150) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_producto_recibido TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ordenes_compra ADD COLUMN factura_observacion TEXT NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_foto_producto VARCHAR(255) NULL;
ALTER TABLE ordenes_compra ADD COLUMN factura_placa_producto VARCHAR(50) NULL;
ALTER TABLE ordenes_compra ADD COLUMN placa_unidad VARCHAR(50) NULL;
ALTER TABLE ordenes_compra ADD COLUMN cotizacion_archivo VARCHAR(255) NULL;
ALTER TABLE ordenes_compra ADD COLUMN cotizacion_nombre VARCHAR(255) NULL;
ALTER TABLE ordenes_compra ADD COLUMN cotizacion_tipo VARCHAR(100) NULL;

ALTER TABLE facturas ADD COLUMN nota_credito_numero VARCHAR(100) NULL;
ALTER TABLE facturas ADD COLUMN nota_credito_fecha DATE NULL;
ALTER TABLE facturas ADD COLUMN nota_credito_monto DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE facturas ADD COLUMN nota_credito_motivo TEXT NULL;
ALTER TABLE facturas ADD COLUMN abono_monto DECIMAL(12,2) NOT NULL DEFAULT 0;
ALTER TABLE facturas ADD COLUMN abono_fecha DATE NULL;
ALTER TABLE facturas ADD COLUMN abono_observacion TEXT NULL;
ALTER TABLE facturas ADD COLUMN factura_fecha_recepcion DATE NULL;
ALTER TABLE facturas ADD COLUMN factura_tipo_entrega VARCHAR(80) NULL;
ALTER TABLE facturas ADD COLUMN factura_entregado_por VARCHAR(150) NULL;
ALTER TABLE facturas ADD COLUMN factura_recibido_por VARCHAR(150) NULL;
ALTER TABLE facturas ADD COLUMN factura_producto_recibido TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE facturas ADD COLUMN factura_observacion TEXT NULL;
ALTER TABLE facturas ADD COLUMN factura_foto_producto VARCHAR(255) NULL;
ALTER TABLE facturas ADD COLUMN factura_placa_producto VARCHAR(50) NULL;

ALTER TABLE revisiones_ruta ADD COLUMN foto_nombre VARCHAR(255) NULL;
ALTER TABLE revisiones_ruta ADD COLUMN foto_tipo VARCHAR(100) NULL;
ALTER TABLE revisiones_ruta ADD COLUMN foto_base64 LONGTEXT NULL;
ALTER TABLE revisiones_ruta_detalle ADD COLUMN foto_nombre VARCHAR(255) NULL;
ALTER TABLE revisiones_ruta_detalle ADD COLUMN foto_tipo VARCHAR(100) NULL;
ALTER TABLE revisiones_ruta_detalle ADD COLUMN foto_base64 LONGTEXT NULL;

ALTER TABLE giras_taller_recomendaciones ADD COLUMN tema_mecanico TEXT NULL;
ALTER TABLE giras_taller_recomendaciones ADD COLUMN tema_estetico TEXT NULL;

ALTER TABLE reportes_supervisores ADD COLUMN descripcion_limpia TEXT NULL;
ALTER TABLE reportes_supervisores ADD COLUMN nota_taller TEXT NULL;
ALTER TABLE reportes_supervisores ADD COLUMN importante TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE reportes_supervisores ADD COLUMN cerrado_por INT NULL;
ALTER TABLE reportes_supervisores ADD COLUMN fecha_cierre DATETIME NULL;
ALTER TABLE reportes_supervisores ADD COLUMN correctivo_id INT NULL;
ALTER TABLE reportes_supervisores ADD COLUMN cierre_motivo TEXT NULL;
ALTER TABLE reportes_supervisores ADD COLUMN cierre_confianza DECIMAL(5,2) NULL;
ALTER TABLE reportes_supervisores ADD COLUMN actualizado_en DATETIME NULL;


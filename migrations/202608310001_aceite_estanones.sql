CREATE TABLE IF NOT EXISTS cambios_aceite (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL UNIQUE,
  sede VARCHAR(100) NOT NULL,
  km_actual INT NOT NULL,
  galones DECIMAL(10,2) NOT NULL DEFAULT 0,
  litros_usados DECIMAL(10,2) NULL,
  proximo_km INT NOT NULL,
  observaciones TEXT NULL,
  creado_por INT NULL,
  fecha TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_cambios_aceite_sede (sede),
  INDEX idx_cambios_aceite_fecha (fecha)
);

CREATE TABLE IF NOT EXISTS cambios_aceite_historial (
  id INT AUTO_INCREMENT PRIMARY KEY,
  unidad_id INT NOT NULL,
  sede VARCHAR(100) NOT NULL,
  km_actual INT NOT NULL,
  galones DECIMAL(10,2) NOT NULL DEFAULT 0,
  litros_usados DECIMAL(10,2) NULL,
  proximo_km INT NOT NULL,
  observaciones TEXT NULL,
  creado_por INT NULL,
  fecha TIMESTAMP NULL,
  archivado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_hist_aceite_unidad (unidad_id),
  INDEX idx_hist_aceite_sede (sede)
);

ALTER TABLE cambios_aceite
  ADD COLUMN litros_usados DECIMAL(10,2) NULL AFTER galones;

ALTER TABLE cambios_aceite_historial
  ADD COLUMN litros_usados DECIMAL(10,2) NULL AFTER galones;

ALTER TABLE cambios_aceite_historial
  ADD COLUMN fecha TIMESTAMP NULL AFTER creado_por;

CREATE TABLE IF NOT EXISTS aceite_estanones (
  id INT AUTO_INCREMENT PRIMARY KEY,
  sede VARCHAR(100) NOT NULL,
  descripcion VARCHAR(180) NULL,
  fecha_compra DATE NOT NULL,
  litros_capacidad DECIMAL(10,2) NOT NULL DEFAULT 208.20,
  litros_restantes DECIMAL(10,2) NOT NULL DEFAULT 208.20,
  estado ENUM('ACTIVO','AGOTADO','CERRADO') NOT NULL DEFAULT 'ACTIVO',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_aceite_estanones_sede_estado (sede, estado),
  INDEX idx_aceite_estanones_fecha (fecha_compra)
);

CREATE TABLE IF NOT EXISTS aceite_movimientos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  estanon_id INT NOT NULL,
  cambio_aceite_id INT NULL,
  sede VARCHAR(100) NOT NULL,
  tipo ENUM('ENTRADA','SALIDA','AJUSTE') NOT NULL,
  litros DECIMAL(10,2) NOT NULL,
  descripcion VARCHAR(255) NULL,
  unidad_id INT NULL,
  placa VARCHAR(50) NULL,
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_aceite_mov_estanon (estanon_id),
  INDEX idx_aceite_mov_sede (sede),
  INDEX idx_aceite_mov_fecha (creado_en)
);

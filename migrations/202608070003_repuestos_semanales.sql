CREATE TABLE IF NOT EXISTS repuestos_semanales (
  id INT AUTO_INCREMENT PRIMARY KEY,
  fecha DATE NOT NULL,
  sede VARCHAR(100) NOT NULL,
  placa VARCHAR(80) NOT NULL,
  solicitud TEXT NOT NULL,
  marcado_rojo TEXT NULL,
  estado ENUM('PENDIENTE','LLEGANDO','COMPLETO') NOT NULL DEFAULT 'PENDIENTE',
  creado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_repuestos_semanales_fecha (fecha),
  INDEX idx_repuestos_semanales_sede (sede),
  INDEX idx_repuestos_semanales_estado (estado),
  INDEX idx_repuestos_semanales_placa (placa)
);


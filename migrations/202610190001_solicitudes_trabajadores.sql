CREATE TABLE IF NOT EXISTS trabajador_solicitudes_acceso (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  cedula VARCHAR(12) NOT NULL UNIQUE,
  nombre_completo VARCHAR(150) NOT NULL,
  puesto VARCHAR(120) NOT NULL,
  sede VARCHAR(100) NOT NULL,
  estado ENUM('PENDIENTE','APROBADA','RECHAZADA') NOT NULL DEFAULT 'PENDIENTE',
  codigo_trabajador VARCHAR(30) NULL,
  perfiles_json JSON NULL,
  revisado_por INT NULL,
  motivo VARCHAR(500) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  revisado_en TIMESTAMP NULL,
  INDEX idx_trabajador_solicitudes_estado_fecha (estado,creado_en)
);

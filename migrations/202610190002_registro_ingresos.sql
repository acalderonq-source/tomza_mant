CREATE TABLE IF NOT EXISTS ingreso_correos (
  identidad VARCHAR(32) PRIMARY KEY,
  correo VARCHAR(254) NOT NULL,
  actualizado_por INT NOT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS sesion_ingresos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  identidad VARCHAR(32) NOT NULL,
  usuario_id INT NOT NULL,
  usuario VARCHAR(120) NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  rol VARCHAR(50) NOT NULL,
  departamento VARCHAR(40) NOT NULL,
  sede VARCHAR(100) NULL,
  ip VARCHAR(64) NULL,
  dispositivo VARCHAR(500) NULL,
  correo_destino VARCHAR(254) NULL,
  correo_estado ENUM('SIN_CORREO','PENDIENTE','ENVIANDO','ENVIADO','ERROR') NOT NULL,
  intentos TINYINT NOT NULL DEFAULT 0,
  ultimo_intento TIMESTAMP NULL,
  enviado_en TIMESTAMP NULL,
  error_codigo VARCHAR(80) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_sesion_ingresos_fecha (creado_en),
  INDEX idx_sesion_ingresos_persona (identidad,creado_en),
  INDEX idx_sesion_ingresos_envio (correo_estado,ultimo_intento)
);

ALTER TABLE trabajador_solicitudes_acceso ADD COLUMN correo VARCHAR(254) NULL;

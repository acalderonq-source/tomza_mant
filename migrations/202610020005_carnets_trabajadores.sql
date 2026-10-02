ALTER TABLE usuario_cedulas
  ADD COLUMN requiere_cambio_pin TINYINT(1) NOT NULL DEFAULT 1 AFTER pin_hash;

CREATE TABLE carnets_trabajador (
  cedula VARCHAR(20) NOT NULL,
  qr_token CHAR(64) NOT NULL,
  foto_data MEDIUMBLOB NULL,
  foto_mime VARCHAR(30) NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (cedula),
  UNIQUE KEY uq_carnets_trabajador_qr_token (qr_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

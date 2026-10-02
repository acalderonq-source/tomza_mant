ALTER TABLE usuarios ADD COLUMN requiere_cambio_password TINYINT(1) NOT NULL DEFAULT 0;

CREATE TABLE usuario_cedulas (
  id BIGINT NOT NULL AUTO_INCREMENT,
  cedula VARCHAR(20) NOT NULL,
  usuario_id INT NOT NULL,
  persona_nombre VARCHAR(150) NOT NULL,
  codigo_trabajador VARCHAR(30) DEFAULT NULL,
  perfil_excel VARCHAR(80) NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuario_cedulas_cuenta (cedula, usuario_id),
  KEY idx_usuario_cedulas_cedula (cedula),
  KEY idx_usuario_cedulas_usuario (usuario_id),
  CONSTRAINT fk_usuario_cedulas_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

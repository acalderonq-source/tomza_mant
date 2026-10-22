-- Personal de la empresa administrado por Recursos Humanos.
-- Los datos se cargan desde Excel en la pantalla; nunca se guardan en el repositorio.
CREATE TABLE IF NOT EXISTS rh_personal (
  empresa VARCHAR(40) NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  actualizado_por INT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (empresa, codigo),
  INDEX idx_rh_personal_nombre (nombre)
) ENGINE=InnoDB;

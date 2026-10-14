CREATE TABLE IF NOT EXISTS cont_presupuestos (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  periodo CHAR(7) NOT NULL,
  sede VARCHAR(120) NOT NULL,
  departamento VARCHAR(40) NOT NULL,
  moneda CHAR(3) NOT NULL,
  rubro VARCHAR(60) NOT NULL,
  monto DECIMAL(16,2) NOT NULL,
  observacion VARCHAR(500) NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  actualizado_por INT NOT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_presupuesto (periodo,sede,departamento,moneda,rubro)
);
CREATE TABLE IF NOT EXISTS cont_clasificaciones (
  fuente VARCHAR(30) NOT NULL,
  documento_id BIGINT NOT NULL,
  sede VARCHAR(120) NOT NULL,
  departamento VARCHAR(40) NOT NULL,
  rubro VARCHAR(60) NOT NULL,
  moneda CHAR(3) NOT NULL,
  actualizado_por INT NOT NULL,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (fuente,documento_id)
);
CREATE TABLE IF NOT EXISTS cont_presupuesto_auditoria (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  actor INT NOT NULL,
  accion VARCHAR(40) NOT NULL,
  referencia VARCHAR(200) NOT NULL,
  antes JSON NULL,
  despues JSON NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

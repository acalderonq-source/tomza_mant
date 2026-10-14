CREATE TABLE IF NOT EXISTS cont_rubro_conceptos (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 periodo CHAR(7) NOT NULL,
 empresa VARCHAR(120) NOT NULL,
 rubro VARCHAR(60) NOT NULL,
 moneda CHAR(3) NOT NULL DEFAULT 'CRC',
 sede VARCHAR(120) NOT NULL DEFAULT 'General de la empresa',
 departamento VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
 concepto VARCHAR(200) NOT NULL,
 presupuesto DECIMAL(16,2) NULL,
 archivo_id BIGINT NULL,
 celda_origen VARCHAR(120) NULL,
 version INT NOT NULL DEFAULT 1,
 actualizado_por INT NOT NULL,
 UNIQUE KEY uq_cont_rubro_origen (archivo_id,celda_origen),
 INDEX idx_cont_rubro_conceptos (periodo,empresa,rubro,moneda)
);
CREATE TABLE IF NOT EXISTS cont_rubro_registros (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 concepto_id BIGINT NOT NULL,
 fecha DATE NOT NULL,
 monto DECIMAL(16,2) NOT NULL,
 proveedor VARCHAR(180) NOT NULL DEFAULT '',
 documento VARCHAR(120) NOT NULL DEFAULT '',
 vencimiento DATE NULL,
 observacion VARCHAR(500) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 actualizado_por INT NOT NULL,
 actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cont_rubro_registro (concepto_id),
 FOREIGN KEY (concepto_id) REFERENCES cont_rubro_conceptos(id)
);
CREATE TABLE IF NOT EXISTS cont_rubro_pagos (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 registro_id BIGINT NOT NULL,
 fecha DATE NOT NULL,
 referencia VARCHAR(120) NOT NULL,
 monto DECIMAL(16,2) NOT NULL,
 actor INT NOT NULL,
 creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cont_rubro_pago (registro_id,referencia),
 FOREIGN KEY (registro_id) REFERENCES cont_rubro_registros(id)
);

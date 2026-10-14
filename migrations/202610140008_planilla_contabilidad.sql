CREATE TABLE IF NOT EXISTS cont_planilla_personas (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 periodo CHAR(7) NOT NULL,
 empresa VARCHAR(120) NOT NULL,
 moneda CHAR(3) NOT NULL DEFAULT 'CRC',
 sede VARCHAR(120) NOT NULL DEFAULT 'General de la empresa',
 departamento VARCHAR(40) NOT NULL DEFAULT 'GENERAL',
 nombre VARCHAR(180) NOT NULL,
 puesto VARCHAR(180) NOT NULL DEFAULT '',
 grupo VARCHAR(120) NOT NULL DEFAULT '',
 presupuesto DECIMAL(16,2) NULL,
 archivo_id BIGINT NULL,
 fila_origen INT NULL,
 periodo_origen VARCHAR(120) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 actualizado_por INT NOT NULL,
 UNIQUE KEY uq_cont_planilla_origen (archivo_id,fila_origen),
 INDEX idx_cont_planilla_personas (periodo,empresa,moneda)
);
CREATE TABLE IF NOT EXISTS cont_planilla_registros (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 persona_id BIGINT NOT NULL,
 fecha DATE NOT NULL,
 salario DECIMAL(16,2) NOT NULL,
 extras DECIMAL(16,2) NOT NULL DEFAULT 0,
 rebajos DECIMAL(16,2) NOT NULL DEFAULT 0,
 observacion VARCHAR(500) NOT NULL DEFAULT '',
 version INT NOT NULL DEFAULT 1,
 actualizado_por INT NOT NULL,
 actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cont_planilla_registro (persona_id),
 FOREIGN KEY (persona_id) REFERENCES cont_planilla_personas(id)
);
CREATE TABLE IF NOT EXISTS cont_planilla_pagos (
 id BIGINT AUTO_INCREMENT PRIMARY KEY,
 registro_id BIGINT NOT NULL,
 fecha DATE NOT NULL,
 referencia VARCHAR(120) NOT NULL,
 monto DECIMAL(16,2) NOT NULL,
 actor INT NOT NULL,
 creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE KEY uq_cont_planilla_pago (registro_id,referencia),
 FOREIGN KEY (registro_id) REFERENCES cont_planilla_registros(id)
);

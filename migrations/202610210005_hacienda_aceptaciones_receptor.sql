-- Respuestas de Hacienda a los mensajes de aceptación que Tomza envía desde Creatica.
-- Una fila por factura (clave de 50 dígitos), con la última respuesta válida.
CREATE TABLE IF NOT EXISTS hacienda_aceptaciones_receptor (
  clave CHAR(50) NOT NULL PRIMARY KEY,
  tipo_mensaje CHAR(2) NOT NULL,
  mensaje_hacienda TINYINT NOT NULL,
  consecutivo_receptor CHAR(20) NOT NULL,
  cedula_emisor VARCHAR(20) NULL,
  cedula_receptor VARCHAR(20) NULL,
  total_factura DECIMAL(18,5) NULL,
  fecha_documento VARCHAR(40) NULL,
  detalle VARCHAR(2000) NULL,
  adjunto_correo_id INT NOT NULL,
  huella_firmante VARCHAR(128) NOT NULL,
  hash_respuesta CHAR(64) NOT NULL,
  registrado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB;

-- Adjuntos XML del correo ya revisados, para no volver a leerlos en cada sincronización.
CREATE TABLE IF NOT EXISTS hacienda_aceptaciones_revisadas (
  adjunto_correo_id INT NOT NULL PRIMARY KEY,
  es_respuesta_receptor TINYINT(1) NOT NULL DEFAULT 0,
  revisado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

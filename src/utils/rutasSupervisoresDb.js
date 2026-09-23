async function ensureRutasSupervisoresTables(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS supervisor_rutas_semanales (
      id INT AUTO_INCREMENT PRIMARY KEY,
      semana_inicio DATE NOT NULL,
      sede VARCHAR(100) NOT NULL,
      ruta VARCHAR(150) NOT NULL,
      chofer VARCHAR(180) NOT NULL,
      unidad_id INT NULL,
      placa_reportada VARCHAR(30) NULL,
      identificador VARCHAR(80) NOT NULL DEFAULT '',
      observacion VARCHAR(255) NULL,
      supervisor_id INT NULL,
      supervisor_nombre VARCHAR(180) NULL,
      activo TINYINT(1) NOT NULL DEFAULT 1,
      creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_supervisor_ruta_unidad_semana (semana_inicio, sede, ruta, identificador),
      INDEX idx_supervisor_rutas_semana_sede (semana_inicio, sede, activo),
      INDEX idx_supervisor_rutas_chofer (chofer, semana_inicio)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS supervisor_rutas_movimientos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      asignacion_id INT NOT NULL,
      accion VARCHAR(30) NOT NULL,
      semana_inicio DATE NOT NULL,
      sede_anterior VARCHAR(100) NULL,
      sede_nueva VARCHAR(100) NULL,
      ruta_anterior VARCHAR(150) NULL,
      ruta_nueva VARCHAR(150) NULL,
      chofer_anterior VARCHAR(180) NULL,
      chofer_nuevo VARCHAR(180) NULL,
      unidad_id_anterior INT NULL,
      unidad_id_nueva INT NULL,
      placa_reportada_anterior VARCHAR(30) NULL,
      placa_reportada_nueva VARCHAR(30) NULL,
      observacion_anterior VARCHAR(255) NULL,
      observacion_nueva VARCHAR(255) NULL,
      motivo VARCHAR(255) NULL,
      cambiado_por INT NULL,
      cambiado_por_nombre VARCHAR(180) NULL,
      cambiado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_supervisor_rutas_mov_asignacion (asignacion_id, cambiado_en),
      INDEX idx_supervisor_rutas_mov_semana (semana_inicio, cambiado_en)
    )
  `);
}

module.exports = { ensureRutasSupervisoresTables };

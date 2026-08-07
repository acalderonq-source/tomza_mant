const { limpiarTextoReporte, analizarCoincidenciaReporteCorrectivo } = require("./reportesSupervisores");

async function tableExists(pool, tableName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?`,
    [tableName]
  );
  return Number(row.count) > 0;
}

async function columnExists(pool, tableName, columnName) {
  const [[row]] = await pool.query(
    `SELECT COUNT(*) AS count
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = ?
       AND COLUMN_NAME = ?`,
    [tableName, columnName]
  );
  return Number(row.count) > 0;
}

async function ensureReportesSupervisoresTables(pool) {
  if (!(await tableExists(pool, "reportes_supervisores"))) {
    await pool.query(`
      CREATE TABLE reportes_supervisores (
        id INT AUTO_INCREMENT PRIMARY KEY,
        unidad_id INT NOT NULL,
        sede VARCHAR(100) NOT NULL,
        supervisor_id INT NULL,
        supervisor_nombre VARCHAR(150) NULL,
        descripcion_original TEXT NOT NULL,
        descripcion_limpia TEXT NULL,
        nota_taller TEXT NULL,
        importante TINYINT(1) NOT NULL DEFAULT 0,
        estado ENUM('PENDIENTE','EN_REVISION','HISTORIAL','DESCARTADO') NOT NULL DEFAULT 'PENDIENTE',
        fecha_reporte DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        semana_reporte DATE NULL,
        actualizado_en DATETIME NULL,
        cerrado_por INT NULL,
        fecha_cierre DATETIME NULL,
        correctivo_id INT NULL,
        cierre_motivo TEXT NULL,
        cierre_confianza DECIMAL(5,2) NULL,
        INDEX idx_reportes_estado_sede (estado, sede),
        INDEX idx_reportes_unidad_estado (unidad_id, estado),
        INDEX idx_reportes_correctivo (correctivo_id)
      )
    `);
  }

  if (!(await tableExists(pool, "reportes_supervisores_sugerencias"))) {
    await pool.query(`
      CREATE TABLE reportes_supervisores_sugerencias (
        id INT AUTO_INCREMENT PRIMARY KEY,
        reporte_id INT NOT NULL,
        correctivo_id INT NOT NULL,
        confianza DECIMAL(5,2) NOT NULL DEFAULT 0,
        motivo TEXT NULL,
        estado ENUM('PENDIENTE','CONFIRMADA','DESCARTADA') NOT NULL DEFAULT 'PENDIENTE',
        creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        resuelto_por INT NULL,
        resuelto_en DATETIME NULL,
        UNIQUE KEY uq_reporte_correctivo (reporte_id, correctivo_id),
        INDEX idx_sugerencias_estado (estado),
        INDEX idx_sugerencias_correctivo (correctivo_id)
      )
    `);
  }

  const columns = [
    ["descripcion_limpia", "TEXT NULL"],
    ["nota_taller", "TEXT NULL"],
    ["importante", "TINYINT(1) NOT NULL DEFAULT 0"],
    ["cerrado_por", "INT NULL"],
    ["fecha_cierre", "DATETIME NULL"],
    ["correctivo_id", "INT NULL"],
    ["cierre_motivo", "TEXT NULL"],
    ["cierre_confianza", "DECIMAL(5,2) NULL"],
    ["actualizado_en", "DATETIME NULL"],
    ["semana_reporte", "DATE NULL"]
  ];

  for (const [column, definition] of columns) {
    if (!(await columnExists(pool, "reportes_supervisores", column))) {
      await pool.query(`ALTER TABLE reportes_supervisores ADD COLUMN ${column} ${definition}`);
    }
  }
}

async function registrarSugerenciasParaCorrectivo(pool, correctivoId) {
  await ensureReportesSupervisoresTables(pool);

  const [[correctivo]] = await pool.query(
    `SELECT c.id, c.unidad_id, c.sede, c.trabajo_realizado, c.pendiente, c.fecha, u.placa
     FROM correctivos c
     JOIN unidades u ON u.id = c.unidad_id
     WHERE c.id = ?`,
    [correctivoId]
  );

  if (!correctivo) return [];

  const [reportes] = await pool.query(
    `SELECT rs.*, u.placa
     FROM reportes_supervisores rs
     JOIN unidades u ON u.id = rs.unidad_id
     WHERE rs.unidad_id = ?
       AND rs.estado IN ('PENDIENTE','EN_REVISION')
       AND COALESCE(rs.semana_reporte, DATE(rs.fecha_reporte)) <= DATE(?)
     ORDER BY rs.fecha_reporte ASC`,
    [correctivo.unidad_id, correctivo.fecha]
  );

  const sugerencias = [];
  for (const reporte of reportes) {
    const analisis = analizarCoincidenciaReporteCorrectivo(reporte, correctivo);
    if (!analisis.coincide) continue;

    await pool.query(
      `INSERT INTO reportes_supervisores_sugerencias
       (reporte_id, correctivo_id, confianza, motivo)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         confianza = VALUES(confianza),
         motivo = VALUES(motivo),
         estado = CASE WHEN estado = 'DESCARTADA' THEN estado ELSE 'PENDIENTE' END`,
      [reporte.id, correctivo.id, analisis.confianza, analisis.motivo]
    );

    sugerencias.push({
      reporte_id: reporte.id,
      correctivo_id: correctivo.id,
      confianza: analisis.confianza,
      motivo: analisis.motivo
    });
  }

  return sugerencias;
}

module.exports = {
  ensureReportesSupervisoresTables,
  registrarSugerenciasParaCorrectivo,
  limpiarTextoReporte
};

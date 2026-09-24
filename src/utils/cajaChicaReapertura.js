async function asegurarColumnasReapertura(pool) {
  const columnas = [
    ["reabierto_en", "DATETIME NULL"],
    ["reabierto_por", "INT NULL"],
    ["documentos_snapshot_json", "LONGTEXT NULL"]
  ];
  for (const [nombre, definicion] of columnas) {
    const [[row]] = await pool.query(
      `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'caja_chica_cortes' AND COLUMN_NAME = ?`,
      [nombre]
    );
    if (!Number(row.total)) {
      await pool.query(`ALTER TABLE caja_chica_cortes ADD COLUMN ${nombre} ${definicion}`);
    }
  }
}

async function reabrirCorteCajaChica(pool, { corteId, usuarioId = null, documentosEsperados = null }) {
  if (!Number.isSafeInteger(corteId) || corteId <= 0) throw new Error("Corte inválido.");
  await asegurarColumnasReapertura(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [[corte]] = await connection.query(
      "SELECT id, estado, reintegro_id, total_documentos FROM caja_chica_cortes WHERE id = ? FOR UPDATE",
      [corteId]
    );
    if (!corte) throw new Error("Corte no encontrado.");
    if (corte.estado !== "GENERADO") throw new Error("Este corte ya fue reabierto o no se puede modificar.");
    const [documentos] = await connection.query(
      "SELECT * FROM caja_chica_documentos WHERE corte_id = ? ORDER BY id ASC FOR UPDATE",
      [corteId]
    );
    if (!documentos.length || (documentosEsperados !== null && documentos.length !== documentosEsperados)) {
      throw new Error("La cantidad de facturas del corte cambió. Actualice la página.");
    }
    const totalCentavos = documentos.reduce((total, documento) => total + Math.round(Number(documento.monto) * 100), 0);
    if (totalCentavos !== Math.round(Number(corte.total_documentos) * 100)) {
      throw new Error("El total del corte no coincide con sus facturas. Revíselo antes de reabrir.");
    }
    if (corte.reintegro_id) {
      const [[reintegro]] = await connection.query(
        "SELECT id FROM caja_chica_reintegros WHERE id = ? FOR UPDATE", [corte.reintegro_id]
      );
      if (!reintegro) throw new Error("No se encontró el reintegro asociado al corte.");
    }
    const [corteActualizado] = await connection.query(
      `UPDATE caja_chica_cortes SET estado = 'REABIERTO', reabierto_en = NOW(),
       reabierto_por = ?, documentos_snapshot_json = ? WHERE id = ? AND estado = 'GENERADO'`,
      [usuarioId, JSON.stringify(documentos), corteId]
    );
    if (corteActualizado.affectedRows !== 1) throw new Error("El corte cambió durante la reapertura.");
    const [documentosActualizados] = await connection.query(
      "UPDATE caja_chica_documentos SET corte_id = NULL, estado = 'CONFIRMADA' WHERE corte_id = ?",
      [corteId]
    );
    if (documentosActualizados.affectedRows !== documentos.length) {
      throw new Error("No se pudieron devolver todas las facturas a caja chica.");
    }
    await connection.commit();
    return { corteId, documentos: documentos.length, monto: totalCentavos / 100 };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = { asegurarColumnasReapertura, reabrirCorteCajaChica };

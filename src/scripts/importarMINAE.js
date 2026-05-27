require("dotenv").config();

const xlsx = require("xlsx");

const pool = require("../db");

(async () => {

  try {

    console.log("📥 Importando MINAE...");

    // =====================================
    // LEER EXCEL
    // =====================================

    const workbook = xlsx.readFile(
      "MINAE POR MES Y AÑO ACTUALIZADO(2).xlsx"
    );

    // =====================================
    // RECORRER HOJAS
    // =====================================

    for (const nombreHoja of workbook.SheetNames) {

      console.log("📄 Hoja:", nombreHoja);

      const hoja =
        workbook.Sheets[nombreHoja];

      const datos =
        xlsx.utils.sheet_to_json(
          hoja
        );

      for (const fila of datos) {

        // =================================
        // DATOS EXCEL
        // =================================

        const placa =
          String(
            fila.UNIDAD || ""
          )
          .replace(/-/g, "")
          .trim();

        const cr =
          fila["CR#"] || null;

        const vencimiento =
          fila.VENCIMIENTO || null;

        const empresa =
          fila.EMPRESA || null;

        let negocio =
          fila.TIPO || null;

        let sede =
          fila.CEDI || null;

        const mes =
          fila.MES || null;

        // =================================
        // NORMALIZAR
        // =================================

        if (sede === "SC") {
          sede = "San Carlos";
        }

        if (
          negocio === "Cilindrero"
        ) {
          negocio = "CILINDRERO";
        }

        // =================================
        // BUSCAR UNIDAD
        // =================================

        const [[unidad]] =
          await pool.query(`
            SELECT
              id,
              placa
            FROM unidades
            WHERE REPLACE(
              REPLACE(placa,'-',''),
              ' ',
              ''
            ) = ?
            LIMIT 1
          `, [placa]);

        if (!unidad) {

          console.log(
            "❌ No encontrada:",
            placa
          );

          continue;

        }

        // =================================
        // INSERT
        // =================================

        await pool.query(`

          INSERT INTO minae_tramites (

            unidad_id,
            sede,
            negocio,

            tipo,
            cr,

            vencimiento,

            empresa,
            mes,

            estado,

            creado_por

          )

          VALUES (

            ?, ?, ?,
            ?, ?,
            ?, ?,
            ?,
            'PENDIENTE',
            1

          )

        `, [

          unidad.id,

          sede,

          negocio,

          negocio,

          cr,

          vencimiento,

          empresa,

          mes

        ]);

        console.log(
          "✅",
          placa
        );

      }

    }

    console.log(
      "🔥 MINAE IMPORTADO"
    );

    process.exit();

  } catch (err) {

    console.error(
      "❌ ERROR:",
      err
    );

    process.exit(1);

  }

})();
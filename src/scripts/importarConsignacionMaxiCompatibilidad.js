const path = require("path");
const XLSX = require("xlsx");
const pool = require("../db");

const PROVEEDOR = "MAXI REPUESTOS";
const FUENTE_CATALOGO = sku => `https://truckdepot.cr/catalogsearch/result/?q=${encodeURIComponent(sku)}`;

function limpiar(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function numero(value) {
  const normalizado = String(value ?? "")
    .replace(/[₡\s]/g, "")
    .replace(/,/g, "");
  const resultado = Number(normalizado);
  return Number.isFinite(resultado) ? resultado : 0;
}

function categoriaProducto(descripcion) {
  const texto = limpiar(descripcion).toUpperCase();
  if (/FILTRO DE (ACEITE|DIESEL|AIRE)|FILTRO DE ELEMENTO/.test(texto)) return "Filtros";
  if (/FRENO|PULMON/.test(texto)) return "Frenos";
  if (/AMORTIGUADOR|BUJE|HULE COMPENSADOR|PIN .*RESORTE|ROLL DELANTERO/.test(texto)) return "Suspensión y dirección";
  if (/CLUTCH|CAMBIOS|COLA DE LA CAJA|SALIDA DE LA CAJA/.test(texto)) return "Transmisión";
  if (/RETENEDOR DE RUEDA/.test(texto)) return "Rodamientos y retenes";
  if (/BOMBILLO|LAMPARA/.test(texto)) return "Eléctrico y luces";
  if (/CINTA REFLECTIVA/.test(texto)) return "Carrocería y seguridad";
  if (/TURBO|TAPA DE VALVULAS|ACELERADOR/.test(texto)) return "Motor";
  if (/TAPON DE RADIADOR/.test(texto)) return "Enfriamiento";
  if (/TUERCA PARA TACO/.test(texto)) return "Llantas";
  return "Repuestos";
}

function servicioProducto(descripcion) {
  const categoria = categoriaProducto(descripcion);
  if (categoria === "Filtros") return "MANTENIMIENTO MOTOR";
  if (categoria === "Frenos") return /FRENO MOTOR|PULMON/i.test(descripcion) ? "MOTOR" : "FRENOS";
  if (categoria === "Suspensión y dirección") return "SUSPENSION Y DIRECCION";
  if (categoria === "Transmisión") return "TRANSMISION";
  if (categoria === "Rodamientos y retenes") return "RODAMIENTOS Y RETENES";
  if (categoria === "Eléctrico y luces") return "ELECTRICO Y LUCES";
  if (categoria === "Carrocería y seguridad") return "CARROCERIA Y SEGURIDAD";
  if (categoria === "Enfriamiento") return "ENFRIAMIENTO";
  if (categoria === "Llantas") return "LLANTAS";
  return "MOTOR";
}

const grupos = {
  universal: new Set(["A23820013104"]),
  electrico24v: new Set(["A01540953010", "A01540952001"]),
  hinoIsuzuProbable: new Set(["X100"]),
  hino300Todo: new Set([
    "J43290003020", "J43420001710", "J43420002420", "J43420001920", "J43420002520",
    "J43010006120", "J43140002020", "J43470001420", "J43470001120", "J43420160020",
    "J43540003520", "J81430005020"
  ]),
  hino300Hasta2011: new Set([
    "J43180002020", "J12020000410", "J12020000310", "J12020000110", "J44090000420",
    "J81430001120", "J81430710341", "J81430002220"
  ]),
  hino300Desde2014: new Set([
    "J43320008420", "J43260007220", "J43260006620", "J43260006420", "J43090051110",
    "J43330010320", "J43330010410"
  ]),
  hino300Hasta2017: new Set(["J43470001820"]),
  hino300Desde2020: new Set(["J43180001410", "J43470002410", "J43470002510"]),
  hino300N04Probable: new Set(["J43010005620"]),
  hino500Todo: new Set(["J43420620020"]),
  hino500Hasta2017: new Set(["J43180001020", "J43180001220", "J43470001520"]),
  hino500ChasisHasta2017: new Set(["J43090050410", "J43090050610", "J43090050510"]),
  hino500ChasisHasta2018: new Set(["J43090050710"]),
  hino500FcHasta2019: new Set(["J43320007020", "J43260005220", "J43460001520", "J43290002420"]),
  hino500MotorProbable: new Set(["J43090002910"]),
  isuzuNqr: new Set([
    "J45420008920", "J45420008810", "J45420008720", "J45180001210", "J45090003620",
    "J81450493041", "J81450001520"
  ]),
  isuzuNqProbable: new Set(["J45090001510"])
};

function compatibilidadPara(sku, configuracion) {
  const marca = limpiar(configuracion.marca).toUpperCase();
  const modelo = limpiar(configuracion.modelo).toUpperCase();
  const anio = Number(configuracion.anio || 0);
  const esHino300 = marca === "HINO" && modelo === "HINO 300";
  const esHino500 = marca === "HINO" && modelo === "HINO 500";
  const esNqr = marca === "ISUZU" && modelo.includes("NQR");

  if (grupos.universal.has(sku)) {
    return { nivel: "VERIFICADA", criterio: "Producto universal para identificación y seguridad de la flota." };
  }
  if (grupos.electrico24v.has(sku) && (marca === "HINO" || marca === "ISUZU")) {
    return { nivel: "VERIFICADA", criterio: "Producto de 24 V para unidades Hino e Isuzu de la flota." };
  }
  if (grupos.hinoIsuzuProbable.has(sku) && (marca === "HINO" || marca === "ISUZU")) {
    return { nivel: "PROBABLE", criterio: "El catálogo indica Hino/Isuzu; confirmar presión y medida antes del despacho." };
  }
  if (grupos.hino300Todo.has(sku) && esHino300) {
    return { nivel: "VERIFICADA", criterio: "Catálogo identifica Hino 300/Dutro o motores W04-N04 de esa familia." };
  }
  if (grupos.hino300Hasta2011.has(sku) && esHino300 && anio <= 2011) {
    return { nivel: "VERIFICADA", criterio: "Aplicación Hino FB/Dutro o W04 para unidades hasta 2011." };
  }
  if (grupos.hino300Desde2014.has(sku) && esHino300 && anio >= 2014) {
    return { nivel: "PROBABLE", criterio: "Aplicación XZU7/WU6; confirmar código de chasis de la unidad." };
  }
  if (grupos.hino300Hasta2017.has(sku) && esHino300 && anio <= 2017) {
    return { nivel: "VERIFICADA", criterio: "Aplicación Hino 300 W04-N04-S05C indicada hasta 2017." };
  }
  if (grupos.hino300Desde2020.has(sku) && esHino300 && anio >= 2020) {
    return { nivel: "VERIFICADA", criterio: "Aplicación Hino N04 indicada para 2020 en adelante." };
  }
  if (grupos.hino300N04Probable.has(sku) && esHino300 && anio >= 2014) {
    return { nivel: "PROBABLE", criterio: "Aplicación motor N04C-V; confirmar variante exacta del motor." };
  }
  if (grupos.hino500Todo.has(sku) && esHino500) {
    return { nivel: "VERIFICADA", criterio: "Catálogo identifica directamente la familia Hino 500." };
  }
  if (grupos.hino500Hasta2017.has(sku) && esHino500 && anio <= 2017) {
    return { nivel: "VERIFICADA", criterio: "Aplicación Hino 500 S05/J05/J08 indicada hasta 2017." };
  }
  if (grupos.hino500ChasisHasta2017.has(sku) && esHino500 && anio <= 2017) {
    return { nivel: "PROBABLE", criterio: "Confirmar chasis FC4J/FD1J o FG1J/FM1J/GD1J antes del despacho." };
  }
  if (grupos.hino500ChasisHasta2018.has(sku) && esHino500 && anio <= 2018) {
    return { nivel: "PROBABLE", criterio: "Confirmar chasis FG1J/FM1J/GD1J antes del despacho." };
  }
  if (grupos.hino500FcHasta2019.has(sku) && esHino500 && anio <= 2019) {
    return { nivel: "PROBABLE", criterio: "Aplicación FC/FD/FG o motor J05; confirmar chasis o motor de la unidad." };
  }
  if (grupos.hino500MotorProbable.has(sku) && esHino500) {
    return { nivel: "PROBABLE", criterio: "Aplicación motor J05/J08; confirmar motor exacto antes del despacho." };
  }
  if (grupos.isuzuNqr.has(sku) && esNqr) {
    return { nivel: "VERIFICADA", criterio: "Catálogo identifica Isuzu NQR o motor 4HK1 confirmado para NQR 2024." };
  }
  if (grupos.isuzuNqProbable.has(sku) && esNqr) {
    return { nivel: "PROBABLE", criterio: "Catálogo indica familia Isuzu NP/NQ; confirmar elemento por chasis." };
  }
  return null;
}

async function existeColumna(conn, tabla, columna) {
  const [[row]] = await conn.query(
    `SELECT COUNT(*) AS total FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, columna]
  );
  return Number(row.total || 0) > 0;
}

async function asegurarEstructura(conn) {
  const columnas = [
    ["nivel_confianza", "VARCHAR(30) NOT NULL DEFAULT 'MANUAL' AFTER observacion"],
    ["criterio_compatibilidad", "VARCHAR(255) NULL AFTER nivel_confianza"],
    ["fuente_url", "VARCHAR(500) NULL AFTER criterio_compatibilidad"]
  ];
  for (const [columna, definicion] of columnas) {
    if (!(await existeColumna(conn, "bodega_compatibilidades", columna))) {
      await conn.query(`ALTER TABLE bodega_compatibilidades ADD COLUMN ${columna} ${definicion}`);
    }
  }
}

async function siguienteCodigoTaller(conn) {
  const [[row]] = await conn.query(`
    SELECT MAX(CAST(codigo_taller AS UNSIGNED)) AS ultimo
    FROM bodega_articulos
    WHERE codigo_taller REGEXP '^[0-9]{4}$'
  `);
  return Number(row.ultimo || 0) + 1;
}

async function ejecutar() {
  const argumentos = process.argv.slice(2);
  const dryRun = argumentos.includes("--dry-run");
  const archivo = argumentos.find(argumento => !argumento.startsWith("--"));
  if (!archivo) throw new Error("Uso: node importarConsignacionMaxiCompatibilidad.js <archivo.xlsx>");

  const libro = XLSX.readFile(path.resolve(archivo), { cellDates: true });
  const hoja = libro.Sheets[libro.SheetNames[0]];
  const filas = XLSX.utils.sheet_to_json(hoja, { defval: null });
  if (!filas.length) throw new Error("El archivo no contiene productos.");

  const conn = await pool.getConnection();
  const resumen = { productosArchivo: filas.length, nuevos: 0, actualizados: 0, configuraciones: 0, unidadesAsignadas: 0, compatibilidades: 0, productosSinCompatibilidad: [] };
  try {
    await asegurarEstructura(conn);
    await conn.beginTransaction();
    const [[admin]] = await conn.query("SELECT id FROM usuarios WHERE rol = 'ADMIN' ORDER BY id LIMIT 1");
    const creadoPor = admin?.id || null;
    let codigoSiguiente = await siguienteCodigoTaller(conn);
    const articulos = new Map();

    for (const fila of filas) {
      const sku = limpiar(fila.SKU).toUpperCase();
      const nombre = limpiar(fila.Descripción);
      if (!sku || !nombre) continue;
      const minimo = numero(fila.Minimo);
      const maximo = numero(fila.Maximo);
      const precio = numero(fila.Precio);
      const categoria = categoriaProducto(nombre);
      const [[existente]] = await conn.query(
        `SELECT * FROM bodega_articulos
         WHERE UPPER(TRIM(codigo)) = ? AND origen_inventario = 'CONSIGNACION'
         ORDER BY activo DESC, id LIMIT 1 FOR UPDATE`,
        [sku]
      );

      let articuloId;
      if (existente) {
        articuloId = existente.id;
        await conn.query(
          `UPDATE bodega_articulos
           SET nombre = ?, tipo_articulo = 'REPUESTO', grupo_bodega = 'INVENTARIO', categoria = ?,
               stock_minimo = ?, stock_maximo = ?, precio_unitario = ?, proveedor_nombre = ?,
               proveedor_consignacion = ?, observacion = ?, activo = 1
           WHERE id = ?`,
          [nombre, categoria, minimo, maximo, precio, PROVEEDOR, PROVEEDOR, "Importado de Consignación Maxi Repuestos doc final.xlsx", articuloId]
        );
        resumen.actualizados += 1;
      } else {
        const codigoTaller = String(codigoSiguiente++).padStart(4, "0");
        const [result] = await conn.query(
          `INSERT INTO bodega_articulos (
            codigo_taller, codigo, nombre, tipo_articulo, grupo_bodega, origen_inventario,
            categoria, unidad_medida, stock_actual, stock_minimo, stock_maximo, ubicacion,
            precio_unitario, proveedor_nombre, proveedor_consignacion, observacion, creado_por
          ) VALUES (?, ?, ?, 'REPUESTO', 'INVENTARIO', 'CONSIGNACION', ?, 'UND', ?, ?, ?, NULL, ?, ?, ?, ?, ?)`,
          [codigoTaller, sku, nombre, categoria, maximo, minimo, maximo, precio, PROVEEDOR, PROVEEDOR, "Importado de Consignación Maxi Repuestos doc final.xlsx", creadoPor]
        );
        articuloId = result.insertId;
        if (maximo > 0) {
          await conn.query(
            `INSERT INTO bodega_movimientos (
              articulo_id, tipo_movimiento, origen_inventario, cantidad, existencia_anterior,
              existencia_nueva, proveedor_nombre, precio_unitario, motivo, creado_por
            ) VALUES (?, 'ENTRADA', 'CONSIGNACION', ?, 0, ?, ?, ?, ?, ?)`,
            [articuloId, maximo, maximo, PROVEEDOR, precio, "Inventario inicial de Consignación Maxi Repuestos doc final.xlsx", creadoPor]
          );
        }
        resumen.nuevos += 1;
      }
      articulos.set(sku, { id: articuloId, nombre, servicio: servicioProducto(nombre) });
    }

    await conn.query(`UPDATE unidades SET motor = '4HK1' WHERE marca = 'Isuzu' AND modelo = 'Isuzu NQR' AND anio = 2024 AND (motor IS NULL OR TRIM(motor) = '')`);
    const [unidades] = await conn.query(`
      SELECT id, placa, marca, modelo, anio, motor
      FROM unidades
      WHERE COALESCE(activa, 1) = 1
        AND marca IS NOT NULL AND TRIM(marca) <> ''
        AND modelo IS NOT NULL AND TRIM(modelo) <> ''
      ORDER BY marca, modelo, anio, placa
    `);

    const configuraciones = new Map();
    for (const unidad of unidades) {
      const motorConfig = unidad.marca === "Isuzu" && unidad.modelo === "Isuzu NQR" ? (unidad.motor || "4HK1") : "";
      const clave = [unidad.marca, unidad.modelo, unidad.anio || "", motorConfig].map(value => limpiar(value).toUpperCase()).join("|");
      let configuracion = configuraciones.get(clave);
      if (!configuracion) {
        const [[existente]] = await conn.query(
          `SELECT * FROM bodega_configuraciones_unidad
           WHERE UPPER(TRIM(marca)) = UPPER(TRIM(?))
             AND UPPER(TRIM(modelo)) = UPPER(TRIM(?))
             AND (anio <=> ?)
             AND UPPER(TRIM(COALESCE(motor, ''))) = UPPER(TRIM(?))
           LIMIT 1`,
          [unidad.marca, unidad.modelo, unidad.anio || null, motorConfig]
        );
        if (existente) {
          configuracion = existente;
        } else {
          const [result] = await conn.query(
            `INSERT INTO bodega_configuraciones_unidad (marca, modelo, anio, motor, descripcion, creado_por)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [unidad.marca, unidad.modelo, unidad.anio || null, motorConfig || null, [unidad.marca, unidad.modelo, unidad.anio, motorConfig].filter(Boolean).join(" "), creadoPor]
          );
          configuracion = { id: result.insertId, marca: unidad.marca, modelo: unidad.modelo, anio: unidad.anio, motor: motorConfig || null };
          resumen.configuraciones += 1;
        }
        configuraciones.set(clave, configuracion);
      }
      await conn.query(
        `INSERT INTO bodega_unidades_configuracion (unidad_id, configuracion_id, creado_por)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE configuracion_id = configuracion_id`,
        [unidad.id, configuracion.id, creadoPor]
      );
      resumen.unidadesAsignadas += 1;
    }

    const configuracionesUnicas = [...configuraciones.values()];
    for (const [sku, articulo] of articulos) {
      let asignaciones = 0;
      for (const configuracion of configuracionesUnicas) {
        const regla = compatibilidadPara(sku, configuracion);
        if (!regla) continue;
        await conn.query(
          `INSERT INTO bodega_compatibilidades (
            configuracion_id, articulo_id, tipo_servicio, cantidad, observacion,
            nivel_confianza, criterio_compatibilidad, fuente_url, creado_por
          ) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?)
          ON DUPLICATE KEY UPDATE
            activo = 1, nivel_confianza = VALUES(nivel_confianza),
            criterio_compatibilidad = VALUES(criterio_compatibilidad), fuente_url = VALUES(fuente_url),
            actualizado_en = CURRENT_TIMESTAMP`,
          [configuracion.id, articulo.id, articulo.servicio, regla.nivel, regla.criterio, FUENTE_CATALOGO(sku), creadoPor]
        );
        asignaciones += 1;
        resumen.compatibilidades += 1;
      }
      if (!asignaciones) resumen.productosSinCompatibilidad.push({ sku, nombre: articulo.nombre });
    }

    if (dryRun) {
      await conn.rollback();
      resumen.modo = "SIMULACION_REVERTIDA";
    } else {
      await conn.commit();
      resumen.modo = "IMPORTACION_APLICADA";
    }
    console.log(JSON.stringify(resumen, null, 2));
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

ejecutar()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });

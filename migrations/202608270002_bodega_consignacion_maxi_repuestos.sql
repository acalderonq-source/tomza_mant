CREATE TEMPORARY TABLE tmp_bodega_consignacion_maxi (
  codigo VARCHAR(80) NOT NULL,
  nombre VARCHAR(180) NOT NULL,
  stock_actual DECIMAL(12,2) NOT NULL DEFAULT 0,
  precio_unitario DECIMAL(12,2) NOT NULL DEFAULT 0
);

INSERT INTO tmp_bodega_consignacion_maxi (codigo, nombre, stock_actual, precio_unitario) VALUES
('J43320008420', 'Amortiguador delantero Hino 300 XZU710/XZU720/XZU730', 4, 22550),
('J43320007020', 'Amortiguador delantero para Hino motor FC9', 8, 34900),
('J45320671704', 'Amortiguador delantero para Isuzu NPR gas', 4, 22500),
('J43290003020', 'Bomba auxiliar de clutch 3/4 Hino Dutro', 3, 25500),
('J43420001710', 'Bomba de frenos delantera 1 3/16 Hino Dutro derecha con grifo (3 agujeros)', 4, 29500),
('J43420002420', 'Bomba de frenos delantera 1 3/16 Hino Dutro derecha para doble tubería', 4, 57500),
('J45420008720', 'Bomba de frenos delantero 1 3/8 NPR/NQR LH con purga', 4, 39500),
('J43460001520', 'Bomba hidráulica para Hino J05', 2, 165100),
('J43290002420', 'Bomba principal de clutch 3/4 Hino', 3, 76450),
('J43290004620', 'Bomba principal de clutch 5/8 Hino', 2, 35500),
('J43260006420', 'Cables de cambios Hino 300 WU650L/XZU710L/XZU720L/XZU730L', 2, 105000),
('J43260002020', 'Cables de cambios rótula plástica/argolla Hino FC4', 2, 140400),
('A23820013104', 'Cinta reflectiva roja y blanca 3M (caja)', 10, 40000),
('J43010005620', 'Empaque de tapa de válvulas Hino N04CV', 2, 24900),
('J43180002020', 'Filtro de aceite Hino 300 W04 02/11', 15, 8900),
('J43180001220', 'Filtro de aceite Hino 500 S05-J05-J08 02/17', 5, 15100),
('J43090051110', 'Filtro de aire primario Hino 300 XZU7-WU6', 15, 18100),
('J43090050610', 'Filtro de aire primario Hino 500 FG1J-FM1J-GD1J 02/17', 5, 40005),
('J43090050710', 'Filtro de aire secundario Hino 500 FG1J-FM1J-GD1J 02/18', 4, 15005),
('J45090003520', 'Filtro de diesel Isuzu NMR/FSR', 4, 12500),
('J43470001410', 'Filtro de diesel primario para Hino W04-N04', 4, 7700),
('J43470001520', 'Filtro de diesel primario para Hino W04-N04-J05-J08 06/17', 4, 6500),
('J43470001120', 'Filtro de diesel secundario para Hino 300 W04-N04', 4, 17500),
('J43180001410', 'Filtro de elemento para aceite Hino N04 20/-', 5, 9500),
('J45090003620', 'Filtro de elemento para diesel Isuzu 4HK1', 4, 15500),
('J43470002510', 'Filtro de elemento para diesel para Hino N04 20/-', 4, 9900),
('A60470005720', 'Filtro separador de agua c/ purga para International, Hino 500', 4, 16200),
('J43580015120', 'Grada derecha para Hino 300 XZU720', 2, 100500),
('J43420160020', 'Kit de empaques de frenos delanteros 1 3/16 Hino 300 1 rueda', 10, 8100),
('J43420220020', 'Kit de empaques de frenos trasero 1 3/16 Hino 300 1 rueda', 6, 18100),
('J43540003520', 'Lampara trasera derecha para Hino Dutro', 4, 8900),
('J43540003620', 'Lampara trasera izquierda para Hino Dutro', 4, 8900),
('J12020000310', 'Pin largo delantero de resorte con rosca delantero Hino FB/Dutro 25 x 117 mm', 4, 6500),
('J12020000110', 'Pin trasero de resorte liso Hino Dutro/FB/Isuzu 25 x 114 mm', 12, 5390),
('J81430001120', 'Retenedor de rueda delantera 101 x 114 x 10 Hino FB/Dutro 716', 6, 4235),
('J81450117141', 'Retenedor de rueda delantera 73 x 90 x 8 Isuzu NPR', 4, 3575),
('J81450493041', 'Retenedor de rueda trasera exterior aceite 49 x 100 x 8 Isuzu NQR', 4, 3109),
('J81430710341', 'Retenedor de rueda trasera exterior aceite 57 x 124 x 14 Hino FB 6 hoyos', 10, 4235),
('J81430002220', 'Retenedor de rueda trasera grasa 127 x 147 x 11 Hino FA/FB/FD', 10, 16100),
('J81450001520', 'Retenedor de rueda trasera grasa 82 x 121 x 12 x 19 Isuzu NQR (BA5471E)', 6, 5935),
('J43330010410', 'Roll delantero de bocina externo para Hino WU600/730/FC', 6, 14263),
('X100', 'Tapon de radiador Hino 300 FC4/FC9/FG1', 5, 5500),
('J41500000510', 'Tapon de radiador Hyundai HD45 D4BB - HD65 - D4ALA - D4ALB - D4ALC', 5, 4150),
('J45320661804', 'Amortiguador trasero Isuzu NP/NQ', 4, 22500),
('J43320005120', 'Amortiguador trasero Hino', 4, 22500),
('J43420001920', 'Bomba de frenos delantera 1 3/16 Hino Dutro izquierda con grifo (3 agujeros)', 4, 29500),
('J43420002520', 'Bomba de frenos delantera 1 3/16 Hino Dutro izquierda para doble tuberia', 4, 57500),
('J45420008810', 'Bomba de frenos delantero 1 3/8 NPR/NQR RH sin purga', 2, 50500),
('J45420008720', 'Bomba de frenos delantero 1 3/8 NPR/NQR RH con purga', 2, 50500),
('J45420160802', 'Servo clutch Hino 500 90mm', 2, 76450),
('J43260006620', 'Cables de neutro Hino 300 WU650L/XZU710L/XZU720L/XZU730L', 1, 90450),
('J43260002020', 'Cable de neutro Hino FC4', 1, 130100),
('J43260005220', 'Cable de acelerador Hino FC4', 1, 65300),
('J43260007220', 'Cable de cambios Hino 300', 1, 120300),
('J43500000520', 'Tapon de radiador Hyundai 1.1', 5, 4150),
('J43180001020', 'Filtro de aceite Hino 500 pequeno S05-J05-J08 02/17', 5, 15100),
('J45180001210', 'Filtro de aceite Isuzu', 10, 8250),
('J43090050410', 'Filtro de aire primario Hino 500 FC4', 5, 33880),
('J43090050510', 'Filtro de aire secundario Hino 500 FC4', 4, 17500),
('J45090001510', 'Filtro de aire Isuzu Reward', 4, 19100),
('J43470002410', 'Filtro de elemento para diesel para Hino N04 20/-', 4, 11000),
('J12020000410', 'Pin corto delantero de resorte con rosca delantero Hino FB/Dutro', 4, 6500);

UPDATE bodega_articulos ba
JOIN tmp_bodega_consignacion_maxi tmp
  ON ba.origen_inventario = 'CONSIGNACION'
 AND ba.codigo = tmp.codigo
 AND ba.nombre = tmp.nombre
SET
  ba.tipo_articulo = 'REPUESTO',
  ba.categoria = 'Consignacion Maxi Repuestos',
  ba.unidad_medida = 'UND',
  ba.stock_actual = tmp.stock_actual,
  ba.stock_maximo = GREATEST(COALESCE(ba.stock_maximo, 0), tmp.stock_actual),
  ba.ubicacion = COALESCE(NULLIF(ba.ubicacion, ''), 'Almacen Cartago'),
  ba.precio_unitario = tmp.precio_unitario,
  ba.proveedor_nombre = 'MAXI REPUESTOS',
  ba.proveedor_consignacion = 'MAXI REPUESTOS',
  ba.activo = 1;

INSERT INTO bodega_articulos (
  codigo, nombre, tipo_articulo, origen_inventario, categoria, unidad_medida,
  stock_actual, stock_minimo, stock_maximo, ubicacion, precio_unitario,
  proveedor_nombre, proveedor_consignacion, activo
)
SELECT
  tmp.codigo,
  tmp.nombre,
  'REPUESTO',
  'CONSIGNACION',
  'Consignacion Maxi Repuestos',
  'UND',
  tmp.stock_actual,
  0,
  tmp.stock_actual,
  'Almacen Cartago',
  tmp.precio_unitario,
  'MAXI REPUESTOS',
  'MAXI REPUESTOS',
  1
FROM tmp_bodega_consignacion_maxi tmp
LEFT JOIN bodega_articulos ba
  ON ba.origen_inventario = 'CONSIGNACION'
 AND ba.codigo = tmp.codigo
 AND ba.nombre = tmp.nombre
WHERE ba.id IS NULL;

DROP TEMPORARY TABLE tmp_bodega_consignacion_maxi;

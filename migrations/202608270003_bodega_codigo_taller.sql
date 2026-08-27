ALTER TABLE bodega_articulos
  ADD COLUMN codigo_taller VARCHAR(4) NULL AFTER id;

CREATE UNIQUE INDEX idx_bodega_articulos_codigo_taller
  ON bodega_articulos (codigo_taller);

UPDATE bodega_articulos
SET codigo_taller = '0001'
WHERE origen_inventario = 'CONSIGNACION'
  AND codigo = 'J43320008420'
  AND nombre = 'Amortiguador delantero Hino 300 XZU710/XZU720/XZU730';

UPDATE bodega_articulos SET codigo_taller = '0002' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43320007020' AND nombre = 'Amortiguador delantero para Hino motor FC9';
UPDATE bodega_articulos SET codigo_taller = '0003' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45320671704' AND nombre = 'Amortiguador delantero para Isuzu NPR gas';
UPDATE bodega_articulos SET codigo_taller = '0004' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43290003020' AND nombre = 'Bomba auxiliar de clutch 3/4 Hino Dutro';
UPDATE bodega_articulos SET codigo_taller = '0005' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420001710' AND nombre = 'Bomba de frenos delantera 1 3/16 Hino Dutro derecha con grifo (3 agujeros)';
UPDATE bodega_articulos SET codigo_taller = '0006' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420002420' AND nombre = 'Bomba de frenos delantera 1 3/16 Hino Dutro derecha para doble tuberia';
UPDATE bodega_articulos SET codigo_taller = '0007' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45420008720' AND nombre = 'Bomba de frenos delantero 1 3/8 NPR/NQR LH con purga';
UPDATE bodega_articulos SET codigo_taller = '0008' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43460001520' AND nombre = 'Bomba hidraulica para Hino J05';
UPDATE bodega_articulos SET codigo_taller = '0009' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43290002420' AND nombre = 'Bomba principal de clutch 3/4 Hino';
UPDATE bodega_articulos SET codigo_taller = '0010' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43290004620' AND nombre = 'Bomba principal de clutch 5/8 Hino';
UPDATE bodega_articulos SET codigo_taller = '0011' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260006420' AND nombre = 'Cables de cambios Hino 300 WU650L/XZU710L/XZU720L/XZU730L';
UPDATE bodega_articulos SET codigo_taller = '0012' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260002020' AND nombre = 'Cables de cambios rotula plastica/argolla Hino FC4';
UPDATE bodega_articulos SET codigo_taller = '0013' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'A23820013104' AND nombre = 'Cinta reflectiva roja y blanca 3M (caja)';
UPDATE bodega_articulos SET codigo_taller = '0014' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43010005620' AND nombre = 'Empaque de tapa de valvulas Hino N04CV';
UPDATE bodega_articulos SET codigo_taller = '0015' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43180002020' AND nombre = 'Filtro de aceite Hino 300 W04 02/11';
UPDATE bodega_articulos SET codigo_taller = '0016' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43180001220' AND nombre = 'Filtro de aceite Hino 500 S05-J05-J08 02/17';
UPDATE bodega_articulos SET codigo_taller = '0017' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43090051110' AND nombre = 'Filtro de aire primario Hino 300 XZU7-WU6';
UPDATE bodega_articulos SET codigo_taller = '0018' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43090050610' AND nombre = 'Filtro de aire primario Hino 500 FG1J-FM1J-GD1J 02/17';
UPDATE bodega_articulos SET codigo_taller = '0019' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43090050710' AND nombre = 'Filtro de aire secundario Hino 500 FG1J-FM1J-GD1J 02/18';
UPDATE bodega_articulos SET codigo_taller = '0020' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45090003520' AND nombre = 'Filtro de diesel Isuzu NMR/FSR';
UPDATE bodega_articulos SET codigo_taller = '0021' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43470001410' AND nombre = 'Filtro de diesel primario para Hino W04-N04';
UPDATE bodega_articulos SET codigo_taller = '0022' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43470001520' AND nombre = 'Filtro de diesel primario para Hino W04-N04-J05-J08 06/17';
UPDATE bodega_articulos SET codigo_taller = '0023' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43470001120' AND nombre = 'Filtro de diesel secundario para Hino 300 W04-N04';
UPDATE bodega_articulos SET codigo_taller = '0024' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43180001410' AND nombre = 'Filtro de elemento para aceite Hino N04 20/-';
UPDATE bodega_articulos SET codigo_taller = '0025' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45090003620' AND nombre = 'Filtro de elemento para diesel Isuzu 4HK1';
UPDATE bodega_articulos SET codigo_taller = '0026' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43470002510' AND nombre = 'Filtro de elemento para diesel para Hino N04 20/-';
UPDATE bodega_articulos SET codigo_taller = '0027' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'A60470005720' AND nombre = 'Filtro separador de agua c/ purga para International, Hino 500';
UPDATE bodega_articulos SET codigo_taller = '0028' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43580015120' AND nombre = 'Grada derecha para Hino 300 XZU720';
UPDATE bodega_articulos SET codigo_taller = '0029' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420160020' AND nombre = 'Kit de empaques de frenos delanteros 1 3/16 Hino 300 1 rueda';
UPDATE bodega_articulos SET codigo_taller = '0030' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420220020' AND nombre = 'Kit de empaques de frenos trasero 1 3/16 Hino 300 1 rueda';
UPDATE bodega_articulos SET codigo_taller = '0031' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43540003520' AND nombre = 'Lampara trasera derecha para Hino Dutro';
UPDATE bodega_articulos SET codigo_taller = '0032' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43540003620' AND nombre = 'Lampara trasera izquierda para Hino Dutro';
UPDATE bodega_articulos SET codigo_taller = '0033' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J12020000310' AND nombre = 'Pin largo delantero de resorte con rosca delantero Hino FB/Dutro 25 x 117 mm';
UPDATE bodega_articulos SET codigo_taller = '0034' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J12020000110' AND nombre = 'Pin trasero de resorte liso Hino Dutro/FB/Isuzu 25 x 114 mm';
UPDATE bodega_articulos SET codigo_taller = '0035' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81430001120' AND nombre = 'Retenedor de rueda delantera 101 x 114 x 10 Hino FB/Dutro 716';
UPDATE bodega_articulos SET codigo_taller = '0036' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81450117141' AND nombre = 'Retenedor de rueda delantera 73 x 90 x 8 Isuzu NPR';
UPDATE bodega_articulos SET codigo_taller = '0037' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81450493041' AND nombre = 'Retenedor de rueda trasera exterior aceite 49 x 100 x 8 Isuzu NQR';
UPDATE bodega_articulos SET codigo_taller = '0038' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81430710341' AND nombre = 'Retenedor de rueda trasera exterior aceite 57 x 124 x 14 Hino FB 6 hoyos';
UPDATE bodega_articulos SET codigo_taller = '0039' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81430002220' AND nombre = 'Retenedor de rueda trasera grasa 127 x 147 x 11 Hino FA/FB/FD';
UPDATE bodega_articulos SET codigo_taller = '0040' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J81450001520' AND nombre = 'Retenedor de rueda trasera grasa 82 x 121 x 12 x 19 Isuzu NQR (BA5471E)';
UPDATE bodega_articulos SET codigo_taller = '0041' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43330010410' AND nombre = 'Roll delantero de bocina externo para Hino WU600/730/FC';
UPDATE bodega_articulos SET codigo_taller = '0042' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'X100' AND nombre = 'Tapon de radiador Hino 300 FC4/FC9/FG1';
UPDATE bodega_articulos SET codigo_taller = '0043' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J41500000510' AND nombre = 'Tapon de radiador Hyundai HD45 D4BB - HD65 - D4ALA - D4ALB - D4ALC';
UPDATE bodega_articulos SET codigo_taller = '0044' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45320661804' AND nombre = 'Amortiguador trasero Isuzu NP/NQ';
UPDATE bodega_articulos SET codigo_taller = '0045' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43320005120' AND nombre = 'Amortiguador trasero Hino';
UPDATE bodega_articulos SET codigo_taller = '0046' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420001920' AND nombre = 'Bomba de frenos delantera 1 3/16 Hino Dutro izquierda con grifo (3 agujeros)';
UPDATE bodega_articulos SET codigo_taller = '0047' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43420002520' AND nombre = 'Bomba de frenos delantera 1 3/16 Hino Dutro izquierda para doble tuberia';
UPDATE bodega_articulos SET codigo_taller = '0048' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45420008810' AND nombre = 'Bomba de frenos delantero 1 3/8 NPR/NQR RH sin purga';
UPDATE bodega_articulos SET codigo_taller = '0049' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45420008720' AND nombre = 'Bomba de frenos delantero 1 3/8 NPR/NQR RH con purga';
UPDATE bodega_articulos SET codigo_taller = '0050' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45420160802' AND nombre = 'Servo clutch Hino 500 90mm';
UPDATE bodega_articulos SET codigo_taller = '0051' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260006620' AND nombre = 'Cables de neutro Hino 300 WU650L/XZU710L/XZU720L/XZU730L';
UPDATE bodega_articulos SET codigo_taller = '0052' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260002020' AND nombre = 'Cable de neutro Hino FC4';
UPDATE bodega_articulos SET codigo_taller = '0053' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260005220' AND nombre = 'Cable de acelerador Hino FC4';
UPDATE bodega_articulos SET codigo_taller = '0054' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43260007220' AND nombre = 'Cable de cambios Hino 300';
UPDATE bodega_articulos SET codigo_taller = '0055' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43500000520' AND nombre = 'Tapon de radiador Hyundai 1.1';
UPDATE bodega_articulos SET codigo_taller = '0056' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43180001020' AND nombre = 'Filtro de aceite Hino 500 pequeno S05-J05-J08 02/17';
UPDATE bodega_articulos SET codigo_taller = '0057' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45180001210' AND nombre = 'Filtro de aceite Isuzu';
UPDATE bodega_articulos SET codigo_taller = '0058' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43090050410' AND nombre = 'Filtro de aire primario Hino 500 FC4';
UPDATE bodega_articulos SET codigo_taller = '0059' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43090050510' AND nombre = 'Filtro de aire secundario Hino 500 FC4';
UPDATE bodega_articulos SET codigo_taller = '0060' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J45090001510' AND nombre = 'Filtro de aire Isuzu Reward';
UPDATE bodega_articulos SET codigo_taller = '0061' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J43470002410' AND nombre = 'Filtro de elemento para diesel para Hino N04 20/-';
UPDATE bodega_articulos SET codigo_taller = '0062' WHERE origen_inventario = 'CONSIGNACION' AND codigo = 'J12020000410' AND nombre = 'Pin corto delantero de resorte con rosca delantero Hino FB/Dutro';

SET @codigo_taller_next := (
  SELECT COALESCE(MAX(CAST(codigo_taller AS UNSIGNED)), 0)
  FROM bodega_articulos
  WHERE codigo_taller REGEXP '^[0-9]{4}$'
);

UPDATE bodega_articulos
SET codigo_taller = LPAD(@codigo_taller_next := @codigo_taller_next + 1, 4, '0')
WHERE (codigo_taller IS NULL OR codigo_taller = '')
  AND tipo_articulo = 'REPUESTO'
ORDER BY id;

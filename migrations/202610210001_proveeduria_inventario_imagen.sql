-- Alta de los 15 artículos visibles en la imagen autorizada el 2026-10-21.
-- Sin cantidades aportadas: existencia inicial cero. Reejecutar conserva fichas y saldos.
INSERT INTO prov_inventario (sede,codigo,descripcion,iva,cantidad) VALUES
('Cartago','SOL-5DC8D0AFB4CA','Anclaje 90 cm',13,0),
('Cartago','SOL-5547AB99239A','Ansell Traje Alphatec Talla L',13,0),
('Cartago','SOL-EC00562A1731','Ansell Traje Alphatec Talla M',13,0),
('Cartago','SOL-DCF2B3BC279B','Arnes 3 argollas MOD 10208271',13,0),
('Cartago','SOL-B5AC0DFF9EAF','Bloqueador solar',13,0),
('Cartago','SOL-9942787B079C','Bota PVC Negra Workman Safety N°37',13,0),
('Cartago','SOL-70913478167D','Bota PVC Negra Workman Safety N°45',13,0),
('Cartago','SOL-C102D9255D5D','Calzas',13,0),
('Cartago','SOL-9603994C774D','Capa 2 piezas',13,0),
('Cartago','SOL-26463A53DAD6','Capa Amarilla larga 2XL',13,0),
('Cartago','SOL-8E10C5AFF2FD','Capa Amarilla larga L',13,0),
('Cartago','SOL-55FE3B0691AF','Capa Amarilla larga M',13,0),
('Cartago','SOL-1423910FAD7D','Capa Amarilla larga S',13,0),
('Cartago','SOL-656CBC090DD8','Capa Amarilla larga XL',13,0),
('Cartago','SOL-309CA0C0B484','Capa larga (capote)',13,0)
ON DUPLICATE KEY UPDATE codigo=VALUES(codigo);

INSERT INTO prov_inventario_fichas (sede,codigo,grupo,tipo,categoria,unidad) VALUES
('Cartago','SOL-5DC8D0AFB4CA','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-5547AB99239A','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-EC00562A1731','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-DCF2B3BC279B','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-B5AC0DFF9EAF','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-9942787B079C','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-70913478167D','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-C102D9255D5D','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-9603994C774D','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-26463A53DAD6','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-8E10C5AFF2FD','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-55FE3B0691AF','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-1423910FAD7D','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-656CBC090DD8','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND'),
('Cartago','SOL-309CA0C0B484','INVENTARIO','CONSUMIBLE','Salud ocupacional','UND')
ON DUPLICATE KEY UPDATE codigo=VALUES(codigo);

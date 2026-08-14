ALTER TABLE pagos_proveedor
  ADD COLUMN pagada TINYINT(1) NOT NULL DEFAULT 0 AFTER partida_presupuestaria;

UPDATE pagos_proveedor
SET pagada = 1
WHERE fecha_pago IS NOT NULL
  AND COALESCE(pagada, 0) = 0;

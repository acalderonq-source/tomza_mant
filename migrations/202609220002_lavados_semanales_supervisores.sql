ALTER TABLE lavado_unidades
  ADD COLUMN semana_inicio DATE
    GENERATED ALWAYS AS (DATE_SUB(fecha, INTERVAL WEEKDAY(fecha) DAY)) STORED
    AFTER fecha;

CREATE UNIQUE INDEX uq_lavado_unidad_semana
  ON lavado_unidades (unidad_id, semana_inicio);

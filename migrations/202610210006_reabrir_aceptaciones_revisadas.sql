-- La primera revisión marcó como "no es respuesta de Creatica" adjuntos cuyo
-- archivo XML no estaba en el servidor. Se reabren para volver a revisarlos;
-- los que sigan sin archivo quedan en estado 2 y se reintentan cada día.
UPDATE hacienda_aceptaciones_revisadas
SET es_respuesta_receptor = 2, revisado_en = '2000-01-01 00:00:00'
WHERE es_respuesta_receptor = 0;

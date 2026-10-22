-- Durante la publicación anterior, la versión vieja siguió corriendo unos minutos
-- y marcó como "no es respuesta de Creatica" adjuntos que no pudo leer.
-- Se reabren para que la versión actual los revise de nuevo.
UPDATE hacienda_aceptaciones_revisadas
SET es_respuesta_receptor = 2, revisado_en = '2000-01-01 00:00:00'
WHERE es_respuesta_receptor = 0;

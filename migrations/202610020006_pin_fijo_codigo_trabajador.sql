UPDATE usuario_cedulas SET requiere_cambio_pin = 0;

ALTER TABLE usuario_cedulas ALTER COLUMN requiere_cambio_pin SET DEFAULT 0;

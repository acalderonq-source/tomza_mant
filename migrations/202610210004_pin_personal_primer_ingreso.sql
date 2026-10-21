-- El PIN deja de ser el código impreso en el carnet: cada persona debe crear
-- un PIN personal en su próximo ingreso con cédula. El código del carnet
-- sigue funcionando solo para ese primer ingreso.
ALTER TABLE usuario_cedulas ALTER COLUMN requiere_cambio_pin SET DEFAULT 1;

UPDATE usuario_cedulas SET requiere_cambio_pin = 1;

ALTER TABLE usuarios ADD COLUMN cedula VARCHAR(20) NULL;
CREATE UNIQUE INDEX uq_usuarios_cedula ON usuarios (cedula);

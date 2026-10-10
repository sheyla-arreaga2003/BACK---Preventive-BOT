-- Impide reservar dos mantenimientos en la misma agencia, fecha y horario.
-- Antes de aplicarlo, confirme que la consulta de duplicados no devuelve filas.
ALTER TABLE maintenance
  ADD CONSTRAINT UQ_Maintenance_Agency_Date_Schedule
  UNIQUE (MAIdAgencie, MADate, MAIdSchedule);

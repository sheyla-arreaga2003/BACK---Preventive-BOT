-- Solo para bases que YA corrieron 20261028_notifications_module.sql con estados en inglés.
-- Convierte MAPStatus a español. En una base nueva usar solo la migración 20261028.

-- 0. La FK de MAIdAgencie se apoya en el índice único; se le da un índice temporal para poder quitarlo.
CREATE INDEX IX_MAP_Agency_Tmp ON MAINTENANCE_APPOINTMENT (MAIdAgencie);

-- 1. MAPActive depende de MAPStatus: se quita junto con su índice y se recrea al final.
--    ENUM temporal con ambos sets para poder migrar los datos.
ALTER TABLE MAINTENANCE_APPOINTMENT
  DROP INDEX UQ_MaintenanceAppointment_ActiveSlot,
  DROP COLUMN MAPActive,
  MODIFY COLUMN MAPStatus
    ENUM('SCHEDULED','CANCELLED','NO_SHOW','COMPLETED','PROGRAMADO','CANCELADO','NO_ASISTIO','COMPLETADO')
    NOT NULL DEFAULT 'PROGRAMADO';

-- 2. Datos.
UPDATE MAINTENANCE_APPOINTMENT SET MAPStatus = 'PROGRAMADO' WHERE MAPStatus = 'SCHEDULED';
UPDATE MAINTENANCE_APPOINTMENT SET MAPStatus = 'CANCELADO'  WHERE MAPStatus = 'CANCELLED';
UPDATE MAINTENANCE_APPOINTMENT SET MAPStatus = 'NO_ASISTIO' WHERE MAPStatus = 'NO_SHOW';
UPDATE MAINTENANCE_APPOINTMENT SET MAPStatus = 'COMPLETADO' WHERE MAPStatus = 'COMPLETED';

-- 3. Set final + horario activo.
ALTER TABLE MAINTENANCE_APPOINTMENT
  MODIFY COLUMN MAPStatus ENUM('PROGRAMADO','CANCELADO','NO_ASISTIO','COMPLETADO')
    NOT NULL DEFAULT 'PROGRAMADO',
  ADD COLUMN MAPActive TINYINT GENERATED ALWAYS AS (IF(MAPStatus = 'PROGRAMADO', 1, NULL)) VIRTUAL,
  ADD UNIQUE KEY UQ_MaintenanceAppointment_ActiveSlot (MAIdAgencie, MAPDate, MAIdSchedule, MAPActive);

-- 4. Ya no hace falta el índice temporal.
DROP INDEX IX_MAP_Agency_Tmp ON MAINTENANCE_APPOINTMENT;

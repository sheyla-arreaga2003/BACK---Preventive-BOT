-- Rollback controlado de 20261113_prepare_mysql_production.sql.
-- Se detiene antes de modificar el esquema si los estados nuevos ya tienen historial
-- o si existen motocicletas con placa NULL.

DELIMITER //

CREATE PROCEDURE PB_RollbackProductionSchema_20261113()
BEGIN
  DECLARE referenced_later_states INT DEFAULT 0;
  DECLARE null_plates INT DEFAULT 0;
  DECLARE invoice_index_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO referenced_later_states
  FROM PROCESSING P
  INNER JOIN STATE_PLATE SP ON SP.STIdState = P.STIdState
  WHERE SP.STState IN (
    'Pago IPRIMA registrado',
    'Documentos presentados y contraseña de pago recibida',
    'Pago final registrado y gestión finalizada',
    'Placas recibidas en Mototec'
  );

  IF referenced_later_states > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Rollback stopped: later plate states are referenced by processing history';
  END IF;

  SELECT COUNT(*) INTO null_plates
  FROM MOTORCYCLES
  WHERE MOPlate IS NULL;

  IF null_plates > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Rollback stopped: motorcycles without a plate must be reviewed first';
  END IF;

  DELETE FROM STATE_PLATE
  WHERE STState IN (
    'Pago IPRIMA registrado',
    'Documentos presentados y contraseña de pago recibida',
    'Pago final registrado y gestión finalizada',
    'Placas recibidas en Mototec'
  );

  ALTER TABLE STATE_PLATE
    MODIFY COLUMN STState VARCHAR(25) NOT NULL;

  ALTER TABLE MOTORCYCLES
    MODIFY COLUMN MOPlate VARCHAR(20) NOT NULL;

  SELECT COUNT(*) INTO invoice_index_exists
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MOTORCYCLES'
    AND INDEX_NAME = 'UQ_Motorcycles_Invoice';

  IF invoice_index_exists > 0 THEN
    ALTER TABLE MOTORCYCLES
      DROP INDEX UQ_Motorcycles_Invoice;
  END IF;
END//

CALL PB_RollbackProductionSchema_20261113()//
DROP PROCEDURE PB_RollbackProductionSchema_20261113//

DELIMITER ;

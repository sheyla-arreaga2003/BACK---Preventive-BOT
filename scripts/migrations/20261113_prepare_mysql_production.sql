-- Preparación controlada del esquema previo a producción.
-- No ejecutar sin respaldo, revisión del preflight y registro en SCHEMA_MIGRATIONS.
-- Esta migración parte del esquema local auditado, que solo contiene los estados 1 y 2.

DELIMITER //

CREATE PROCEDURE PB_MigrateProductionSchema_20261113()
BEGIN
  DECLARE duplicate_invoice_groups INT DEFAULT 0;
  DECLARE later_plate_states INT DEFAULT 0;
  DECLARE invoice_index_exists INT DEFAULT 0;

  SELECT COUNT(*) INTO duplicate_invoice_groups
  FROM (
    SELECT MOSerieInvoice, MONumberInvoice
    FROM MOTORCYCLES
    GROUP BY MOSerieInvoice, MONumberInvoice
    HAVING COUNT(*) > 1
  ) duplicate_invoices;

  IF duplicate_invoice_groups > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration stopped: duplicate motorcycle invoices require manual review';
  END IF;

  SELECT COUNT(*) INTO later_plate_states
  FROM STATE_PLATE
  WHERE STState IN (
    'Pago IPRIMA registrado',
    'Documentos presentados y contraseña de pago recibida',
    'Pago final registrado y gestión finalizada',
    'Placas recibidas en Mototec'
  );

  IF later_plate_states > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Migration stopped: later plate states already exist or the migration is partially applied';
  END IF;

  ALTER TABLE STATE_PLATE
    MODIFY COLUMN STState VARCHAR(100) NOT NULL;

  ALTER TABLE MOTORCYCLES
    MODIFY COLUMN MOPlate VARCHAR(20) NULL;

  SELECT COUNT(*) INTO invoice_index_exists
  FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'MOTORCYCLES'
    AND INDEX_NAME = 'UQ_Motorcycles_Invoice';

  IF invoice_index_exists = 0 THEN
    ALTER TABLE MOTORCYCLES
      ADD UNIQUE KEY UQ_Motorcycles_Invoice (MOSerieInvoice, MONumberInvoice);
  END IF;

  INSERT INTO STATE_PLATE (STState) VALUES
    ('Pago IPRIMA registrado'),
    ('Documentos presentados y contraseña de pago recibida'),
    ('Pago final registrado y gestión finalizada'),
    ('Placas recibidas en Mototec');
END//

CALL PB_MigrateProductionSchema_20261113()//
DROP PROCEDURE PB_MigrateProductionSchema_20261113//

DELIMITER ;

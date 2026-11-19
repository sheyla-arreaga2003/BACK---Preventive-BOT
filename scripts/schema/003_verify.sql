-- Preventive Bot - verificación de una instalación nueva.
-- Solo ejecuta consultas de lectura. No modifica el esquema ni los datos.

SELECT VERSION() AS mysql_version,
       @@lower_case_table_names AS lower_case_table_names,
       @@character_set_database AS database_character_set,
       @@collation_database AS database_collation,
       @@session.time_zone AS session_time_zone;

SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
ORDER BY TABLE_NAME;

SELECT COUNT(*) AS base_table_count
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_TYPE = 'BASE TABLE';

SELECT COUNT(*) AS foreign_key_count
FROM information_schema.REFERENTIAL_CONSTRAINTS
WHERE CONSTRAINT_SCHEMA = DATABASE();

SELECT TABLE_NAME, INDEX_NAME,
       GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS indexed_columns,
       MIN(NON_UNIQUE) AS non_unique
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = DATABASE()
GROUP BY TABLE_NAME, INDEX_NAME
ORDER BY TABLE_NAME, INDEX_NAME;

SELECT 'ROL' AS catalog_name, COUNT(*) AS row_count FROM ROL
UNION ALL SELECT 'STATE_PLATE', COUNT(*) FROM STATE_PLATE
UNION ALL SELECT 'agencies', COUNT(*) FROM agencies
UNION ALL SELECT 'schedules', COUNT(*) FROM schedules
UNION ALL SELECT 'SERVICES', COUNT(*) FROM SERVICES
UNION ALL SELECT 'NOTIFICATION_SETTING', COUNT(*) FROM NOTIFICATION_SETTING;

SELECT STIdState, STState, CHAR_LENGTH(STState) AS state_length
FROM STATE_PLATE
ORDER BY STIdState;

SELECT COUNT(*) AS duplicate_invoice_groups
FROM (
  SELECT MOSerieInvoice, MONumberInvoice
  FROM MOTORCYCLES
  GROUP BY MOSerieInvoice, MONumberInvoice
  HAVING COUNT(*) > 1
) duplicate_invoices;

SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = DATABASE()
  AND TABLE_NAME IN ('MOTORCYCLES', 'STATE_PLATE')
  AND COLUMN_NAME IN ('MOPlate', 'MOSerieInvoice', 'MONumberInvoice', 'STState')
ORDER BY TABLE_NAME, ORDINAL_POSITION;

SELECT TRIGGER_NAME
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = DATABASE();

SELECT ROUTINE_NAME, ROUTINE_TYPE
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = DATABASE();

SELECT EVENT_NAME, STATUS
FROM information_schema.EVENTS
WHERE EVENT_SCHEMA = DATABASE();

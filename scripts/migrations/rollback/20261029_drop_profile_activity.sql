-- Explicit rollback for 20261029_create_profile_activity.sql.
-- Run only after backing up USER_ACTIVITY and confirming the target environment.
-- This removes the activity history and the stored last-login timestamp.

DROP TABLE IF EXISTS USER_ACTIVITY;

SET @profile_last_login_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'USERS'
    AND COLUMN_NAME = 'USLastLoginAt'
);
SET @profile_last_login_sql = IF(
  @profile_last_login_exists = 1,
  'ALTER TABLE USERS DROP COLUMN USLastLoginAt',
  'SELECT ''USERS.USLastLoginAt does not exist'' AS rollback_info'
);
PREPARE profile_last_login_statement FROM @profile_last_login_sql;
EXECUTE profile_last_login_statement;
DEALLOCATE PREPARE profile_last_login_statement;


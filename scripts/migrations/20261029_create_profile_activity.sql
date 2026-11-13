-- Apply only after confirming that the target is the development database.
-- This migration is additive and does not backfill historical activity.

SET @profile_last_login_exists = (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'USERS'
    AND COLUMN_NAME = 'USLastLoginAt'
);
SET @profile_last_login_sql = IF(
  @profile_last_login_exists = 0,
  'ALTER TABLE USERS ADD COLUMN USLastLoginAt DATETIME(3) NULL AFTER USFregister',
  'SELECT ''USERS.USLastLoginAt already exists'' AS migration_info'
);
PREPARE profile_last_login_statement FROM @profile_last_login_sql;
EXECUTE profile_last_login_statement;
DEALLOCATE PREPARE profile_last_login_statement;

CREATE TABLE IF NOT EXISTS USER_ACTIVITY (
  UAId BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  USId INT NOT NULL,
  UAEventType ENUM(
    'CLIENT_CREATED',
    'CLIENT_UPDATED',
    'MAINTENANCE_CREATED',
    'PLATE_PROCESS_UPDATED'
  ) NOT NULL,
  UAEntityType VARCHAR(40) NOT NULL,
  UAEntityId VARCHAR(64) NULL,
  UACreatedAt DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (UAId),
  KEY IX_UserActivity_User_Date (USId, UACreatedAt),
  KEY IX_UserActivity_User_Type_Date (USId, UAEventType, UACreatedAt),
  CONSTRAINT FK_UserActivity_User FOREIGN KEY (USId) REFERENCES USERS (USId)
    ON DELETE RESTRICT ON UPDATE NO ACTION
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

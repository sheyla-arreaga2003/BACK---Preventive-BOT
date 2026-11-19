-- Preventive Bot - esquema base MySQL
-- Generado a partir de la estructura local de Mototec el 2026-11-13.
-- Contiene únicamente estructura. No incluye usuarios, clientes ni datos operativos.
-- Requiere MySQL 8.0.16 o posterior; validado en MySQL Linux 8.4.13
-- y comparado con la estructura local de MySQL 9.7.1.
-- Aplicar únicamente sobre una base vacía con utf8mb4.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '-06:00';
SET FOREIGN_KEY_CHECKS = 0;

CREATE TABLE `ROL` (
  `ROIdRol` int NOT NULL AUTO_INCREMENT,
  `ROName` varchar(50) NOT NULL,
  `RODescripcion` varchar(100) DEFAULT NULL,
  PRIMARY KEY (`ROIdRol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `CUSTOMER` (
  `CUIdCustomer` int NOT NULL AUTO_INCREMENT,
  `CUName` varchar(100) NOT NULL,
  `CULastName` varchar(100) NOT NULL,
  `CUDPI` varchar(20) NOT NULL,
  `CUPhone` varchar(20) NOT NULL,
  `CUMail` varchar(150) NOT NULL,
  `CUAddress` varchar(250) NOT NULL,
  `CUFregister` datetime DEFAULT CURRENT_TIMESTAMP,
  `CUState` tinyint DEFAULT '1',
  `CUNIT` varchar(13) NOT NULL,
  PRIMARY KEY (`CUIdCustomer`),
  UNIQUE KEY `CUDPI` (`CUDPI`),
  UNIQUE KEY `CUMail` (`CUMail`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `agencies` (
  `AGIdAgencie` int NOT NULL AUTO_INCREMENT,
  `AGName` varchar(30) NOT NULL,
  `AGActive` bit(1) NOT NULL DEFAULT b'1',
  PRIMARY KEY (`AGIdAgencie`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `schedules` (
  `SCIdSchedule` int NOT NULL AUTO_INCREMENT,
  `SCTime` time NOT NULL,
  `SCActive` bit(1) NOT NULL DEFAULT b'1',
  PRIMARY KEY (`SCIdSchedule`),
  UNIQUE KEY `SCTime_UNIQUE` (`SCTime`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SERVICES` (
  `SEIdService` int NOT NULL AUTO_INCREMENT,
  `SEName` varchar(100) NOT NULL,
  `SEDescription` varchar(250) NOT NULL,
  `SEMilesRecom` varchar(20) DEFAULT NULL,
  `SETimeRecom` varchar(25) DEFAULT NULL,
  `SEPriceRef` varchar(10) DEFAULT NULL,
  `SEState` tinyint DEFAULT '1',
  `SEDetails` varchar(250) DEFAULT NULL,
  PRIMARY KEY (`SEIdService`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SPARE_PARTS` (
  `SPId` int NOT NULL AUTO_INCREMENT,
  `SPNname` varchar(100) NOT NULL,
  `SPBrand` varchar(50) NOT NULL,
  `SPDescription` varchar(250) NOT NULL,
  PRIMARY KEY (`SPId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `STATE_PLATE` (
  `STIdState` int NOT NULL AUTO_INCREMENT,
  `STState` varchar(100) NOT NULL,
  PRIMARY KEY (`STIdState`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `USERS` (
  `USId` int NOT NULL AUTO_INCREMENT,
  `USName` varchar(100) NOT NULL,
  `ROIdRol` int DEFAULT NULL,
  `USLastName` varchar(100) NOT NULL,
  `USEmail` varchar(150) NOT NULL,
  `USPhone` varchar(20) DEFAULT NULL,
  `USPassword` varchar(255) NOT NULL,
  `USFregister` datetime DEFAULT CURRENT_TIMESTAMP,
  `USLastLoginAt` datetime(3) DEFAULT NULL,
  PRIMARY KEY (`USId`),
  UNIQUE KEY `USEmail` (`USEmail`),
  KEY `ROIdRol` (`ROIdRol`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`ROIdRol`) REFERENCES `ROL` (`ROIdRol`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `MOTORCYCLES` (
  `MOIdMoto` int NOT NULL AUTO_INCREMENT,
  `CUIdCustomer` int DEFAULT NULL,
  `MOPlate` varchar(20) DEFAULT NULL,
  `MOBrand` varchar(50) NOT NULL,
  `MOModel` varchar(50) NOT NULL,
  `MOYear` varchar(4) NOT NULL,
  `MOColor` varchar(20) NOT NULL,
  `MOCilindraje` varchar(50) DEFAULT NULL,
  `MOVin` varchar(70) NOT NULL,
  `MOMiles` varchar(20) DEFAULT NULL,
  `MOFRegister` datetime DEFAULT CURRENT_TIMESTAMP,
  `MOChassis` varchar(50) DEFAULT NULL,
  `MOState` tinyint DEFAULT '1',
  `MOSerieInvoice` varchar(10) NOT NULL,
  `MONumberInvoice` varchar(10) NOT NULL,
  PRIMARY KEY (`MOIdMoto`),
  UNIQUE KEY `MOPlate` (`MOPlate`),
  UNIQUE KEY `UQ_Motorcycles_Invoice` (`MOSerieInvoice`,`MONumberInvoice`),
  KEY `CUIdCustomer` (`CUIdCustomer`),
  CONSTRAINT `motorcycles_ibfk_1` FOREIGN KEY (`CUIdCustomer`) REFERENCES `CUSTOMER` (`CUIdCustomer`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `maintenance` (
  `MAMaintenance` int NOT NULL AUTO_INCREMENT,
  `MAIdAgencie` int NOT NULL,
  `MAIdSchedule` int DEFAULT NULL,
  `MOIdMoto` int DEFAULT NULL,
  `USId` int DEFAULT NULL,
  `MADate` date NOT NULL,
  `MAMiles` varchar(10) DEFAULT NULL,
  `MAObservations` varchar(250) DEFAULT NULL,
  `MANextMiles` varchar(10) DEFAULT NULL,
  `MANextDate` varchar(10) DEFAULT NULL,
  PRIMARY KEY (`MAMaintenance`),
  UNIQUE KEY `UQ_Maintenance_Agency_Date_Schedule` (`MAIdAgencie`,`MADate`,`MAIdSchedule`),
  KEY `MOIdMoto` (`MOIdMoto`),
  KEY `USId` (`USId`),
  KEY `FK_MAIdSchedule` (`MAIdSchedule`),
  CONSTRAINT `FK_MAIdAgencie` FOREIGN KEY (`MAIdAgencie`) REFERENCES `agencies` (`AGIdAgencie`),
  CONSTRAINT `FK_MAIdSchedule` FOREIGN KEY (`MAIdSchedule`) REFERENCES `schedules` (`SCIdSchedule`),
  CONSTRAINT `maintenance_ibfk_1` FOREIGN KEY (`MOIdMoto`) REFERENCES `MOTORCYCLES` (`MOIdMoto`),
  CONSTRAINT `maintenance_ibfk_2` FOREIGN KEY (`USId`) REFERENCES `USERS` (`USId`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `DETAIL_MAINTENANCE` (
  `DMIdDetail` int NOT NULL AUTO_INCREMENT,
  `MAMaintenance` int DEFAULT NULL,
  `SEIdService` int DEFAULT NULL,
  `SEAmount` varchar(10) NOT NULL,
  PRIMARY KEY (`DMIdDetail`),
  KEY `MAMaintenance` (`MAMaintenance`),
  KEY `SEIdService` (`SEIdService`),
  CONSTRAINT `detail_maintenance_ibfk_1` FOREIGN KEY (`MAMaintenance`) REFERENCES `maintenance` (`MAMaintenance`),
  CONSTRAINT `detail_maintenance_ibfk_2` FOREIGN KEY (`SEIdService`) REFERENCES `SERVICES` (`SEIdService`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `MAINTENANCE_APPOINTMENT` (
  `MAPIdAppointment` int NOT NULL AUTO_INCREMENT,
  `MOIdMoto` int NOT NULL,
  `MAIdAgencie` int NOT NULL,
  `MAIdSchedule` int NOT NULL,
  `MAPDate` date NOT NULL,
  `MAPMileage` varchar(50) DEFAULT NULL,
  `MAPObservations` varchar(500) DEFAULT NULL,
  `MAPStatus` enum('PROGRAMADO','CANCELADO','NO_ASISTIO','COMPLETADO') NOT NULL DEFAULT 'PROGRAMADO',
  `MAPCreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `MAPStatusAt` datetime DEFAULT NULL,
  `MAPActive` tinyint GENERATED ALWAYS AS (if((`MAPStatus` = _utf8mb4'PROGRAMADO'),1,NULL)) VIRTUAL,
  PRIMARY KEY (`MAPIdAppointment`),
  UNIQUE KEY `UQ_MaintenanceAppointment_ActiveSlot` (`MAIdAgencie`,`MAPDate`,`MAIdSchedule`,`MAPActive`),
  KEY `IX_MaintenanceAppointment_Motorcycle` (`MOIdMoto`,`MAPDate`),
  KEY `FK_MaintenanceAppointment_Schedule` (`MAIdSchedule`),
  CONSTRAINT `FK_MaintenanceAppointment_Agency` FOREIGN KEY (`MAIdAgencie`) REFERENCES `agencies` (`AGIdAgencie`),
  CONSTRAINT `FK_MaintenanceAppointment_Motorcycle` FOREIGN KEY (`MOIdMoto`) REFERENCES `MOTORCYCLES` (`MOIdMoto`),
  CONSTRAINT `FK_MaintenanceAppointment_Schedule` FOREIGN KEY (`MAIdSchedule`) REFERENCES `schedules` (`SCIdSchedule`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `MAINTENANCE_APPOINTMENT_SERVICE` (
  `MAPIdAppointment` int NOT NULL,
  `SEIdService` int NOT NULL,
  PRIMARY KEY (`MAPIdAppointment`,`SEIdService`),
  KEY `FK_AppointmentService_Service` (`SEIdService`),
  CONSTRAINT `FK_AppointmentService_Appointment` FOREIGN KEY (`MAPIdAppointment`) REFERENCES `MAINTENANCE_APPOINTMENT` (`MAPIdAppointment`) ON DELETE CASCADE,
  CONSTRAINT `FK_AppointmentService_Service` FOREIGN KEY (`SEIdService`) REFERENCES `SERVICES` (`SEIdService`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `PROCESSING` (
  `PRIdProcess` int NOT NULL AUTO_INCREMENT,
  `MOIdMoto` int DEFAULT NULL,
  `STIdState` int DEFAULT NULL,
  `PRFirstDate` varchar(20) NOT NULL,
  `PRDateUpdate` varchar(20) NOT NULL,
  `PRObservations` varchar(250) NOT NULL,
  PRIMARY KEY (`PRIdProcess`),
  KEY `MOIdMoto` (`MOIdMoto`),
  KEY `STIdState` (`STIdState`),
  CONSTRAINT `processing_ibfk_1` FOREIGN KEY (`MOIdMoto`) REFERENCES `MOTORCYCLES` (`MOIdMoto`),
  CONSTRAINT `processing_ibfk_2` FOREIGN KEY (`STIdState`) REFERENCES `STATE_PLATE` (`STIdState`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `NOTIFICATION_SETTING` (
  `NSType` varchar(40) NOT NULL,
  `NSEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `NSLeadDays` smallint unsigned DEFAULT NULL,
  `NSUpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`NSType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `NOTIFICATION` (
  `NOIdNotification` bigint NOT NULL AUTO_INCREMENT,
  `NOType` varchar(40) NOT NULL,
  `NOTitle` varchar(150) NOT NULL,
  `NOMessage` varchar(500) NOT NULL,
  `NOEntity` varchar(30) DEFAULT NULL,
  `NOEntityId` int DEFAULT NULL,
  `NODedupeKey` varchar(120) NOT NULL,
  `NOReadAt` datetime DEFAULT NULL,
  `NOCreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`NOIdNotification`),
  UNIQUE KEY `UQ_Notification_Dedupe` (`NODedupeKey`),
  KEY `IX_Notification_Inbox` (`NOReadAt`,`NOCreatedAt`),
  KEY `IX_Notification_Entity` (`NOEntity`,`NOEntityId`),
  KEY `FK_Notification_Setting` (`NOType`),
  CONSTRAINT `FK_Notification_Setting` FOREIGN KEY (`NOType`) REFERENCES `NOTIFICATION_SETTING` (`NSType`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `REMINDER` (
  `REIdReminder` int NOT NULL AUTO_INCREMENT,
  `MAMaintenance` int DEFAULT NULL,
  `CUIdCustomer` int DEFAULT NULL,
  `USId` int DEFAULT NULL,
  `MAPIdAppointment` int DEFAULT NULL,
  `REDateProgram` datetime NOT NULL,
  `REAttemptedAt` datetime DEFAULT NULL,
  `REType` varchar(150) NOT NULL,
  `REState` tinyint DEFAULT '1',
  `RESentAt` datetime DEFAULT NULL,
  `REError` varchar(500) DEFAULT NULL,
  `RETries` tinyint unsigned NOT NULL DEFAULT '0',
  `REFSend` varchar(20) NOT NULL,
  `RERecipient` varchar(254) DEFAULT NULL,
  `RERequestKey` varchar(64) DEFAULT NULL,
  `REDescription` text NOT NULL,
  `RETitle` varchar(150) NOT NULL,
  PRIMARY KEY (`REIdReminder`),
  UNIQUE KEY `UQ_Reminder_Maintenance_Type` (`MAMaintenance`,`REType`,`REDateProgram`),
  UNIQUE KEY `UQ_Reminder_RequestKey` (`RERequestKey`),
  KEY `IX_Reminder_Pending` (`REState`,`REFSend`,`REDateProgram`),
  KEY `FK_Reminder_Appointment` (`MAPIdAppointment`),
  KEY `IX_Reminder_Customer` (`CUIdCustomer`),
  KEY `IX_Reminder_Admin_State` (`USId`,`REState`),
  KEY `IX_Reminder_History_State_Date` (`REState`,`REAttemptedAt`,`REIdReminder`),
  KEY `IX_Reminder_History_Type_Date` (`REType`,`REAttemptedAt`,`REIdReminder`),
  KEY `IX_Reminder_History_Recipient` (`RERecipient`),
  CONSTRAINT `FK_Reminder_Appointment` FOREIGN KEY (`MAPIdAppointment`) REFERENCES `MAINTENANCE_APPOINTMENT` (`MAPIdAppointment`),
  CONSTRAINT `FK_Reminder_Customer` FOREIGN KEY (`CUIdCustomer`) REFERENCES `CUSTOMER` (`CUIdCustomer`),
  CONSTRAINT `FK_Reminder_User` FOREIGN KEY (`USId`) REFERENCES `USERS` (`USId`),
  CONSTRAINT `reminder_ibfk_1` FOREIGN KEY (`MAMaintenance`) REFERENCES `maintenance` (`MAMaintenance`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `USER_PREFERENCES` (
  `USId` int NOT NULL,
  `UPTheme` enum('light','dark','system') NOT NULL DEFAULT 'light',
  `UPAccentColor` enum('red','blue','purple','green','yellow','orange','sky','pink') NOT NULL DEFAULT 'red',
  `UPBackground` enum('motorcycle','gray','white','custom') NOT NULL DEFAULT 'motorcycle',
  `UPModules` json NOT NULL,
  `UPHomePage` varchar(40) NOT NULL DEFAULT 'home',
  `UPCompactMenu` tinyint(1) NOT NULL DEFAULT '0',
  `UPShowChatbot` tinyint(1) NOT NULL DEFAULT '1',
  `UPNotificationsEnabled` tinyint(1) NOT NULL DEFAULT '1',
  `UPCreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UPUpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`USId`),
  CONSTRAINT `FK_UserPreferences_User` FOREIGN KEY (`USId`) REFERENCES `USERS` (`USId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `USER_MEDIA` (
  `UMId` char(36) NOT NULL,
  `USId` int NOT NULL,
  `UMKind` enum('AVATAR','BACKGROUND') NOT NULL,
  `UMMimeType` varchar(30) NOT NULL,
  `UMContent` mediumblob NOT NULL,
  `UMSize` int unsigned NOT NULL,
  `UMCreatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `UMUpdatedAt` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`UMId`),
  UNIQUE KEY `UQ_UserMedia_User_Kind` (`USId`,`UMKind`),
  CONSTRAINT `FK_UserMedia_User` FOREIGN KEY (`USId`) REFERENCES `USERS` (`USId`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `USER_ACTIVITY` (
  `UAId` bigint unsigned NOT NULL AUTO_INCREMENT,
  `USId` int NOT NULL,
  `UAEventType` enum('CLIENT_CREATED','CLIENT_UPDATED','MAINTENANCE_CREATED','PLATE_PROCESS_UPDATED') NOT NULL,
  `UAEntityType` varchar(40) NOT NULL,
  `UAEntityId` varchar(64) DEFAULT NULL,
  `UACreatedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`UAId`),
  KEY `IX_UserActivity_User_Date` (`USId`,`UACreatedAt`),
  KEY `IX_UserActivity_User_Type_Date` (`USId`,`UAEventType`,`UACreatedAt`),
  CONSTRAINT `FK_UserActivity_User` FOREIGN KEY (`USId`) REFERENCES `USERS` (`USId`) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

CREATE TABLE `SCHEMA_MIGRATIONS` (
  `SMVersion` varchar(80) NOT NULL,
  `SMChecksum` char(64) NOT NULL,
  `SMDescription` varchar(255) NOT NULL,
  `SMStatus` enum('APPLYING','APPLIED','FAILED') NOT NULL,
  `SMStartedAt` datetime(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `SMFinishedAt` datetime(3) DEFAULT NULL,
  `SMError` varchar(1000) DEFAULT NULL,
  PRIMARY KEY (`SMVersion`),
  KEY `IX_SchemaMigrations_Status_Started` (`SMStatus`,`SMStartedAt`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

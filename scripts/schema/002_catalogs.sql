-- Preventive Bot - catálogos iniciales
-- Extraídos mediante consultas de solo lectura de Mototec local el 2026-11-13.
-- No contiene clientes, motocicletas, usuarios, contraseñas ni datos operativos.
-- Aplicar después de 001_schema.sql y únicamente sobre una base vacía.

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '-06:00';
START TRANSACTION;

INSERT INTO `ROL` (`ROIdRol`, `ROName`, `RODescripcion`) VALUES
  (1, 'Admin', 'Administrador del sistema');

INSERT INTO `STATE_PLATE` (`STIdState`, `STState`) VALUES
  (1, 'Verificación de NIT'),
  (2, 'Solicitud primeras placas');

-- Los identificadores posteriores los asigna MySQL. El backend relaciona estas
-- etapas por su nombre, no mediante identificadores numéricos fijos.
INSERT INTO `STATE_PLATE` (`STState`) VALUES
  ('Pago IPRIMA registrado'),
  ('Documentos presentados y contraseña de pago recibida'),
  ('Pago final registrado y gestión finalizada'),
  ('Placas recibidas en Mototec');

INSERT INTO `agencies` (`AGIdAgencie`, `AGName`, `AGActive`) VALUES
  (1, 'Mototec Quetzaltenango', 1);

INSERT INTO `schedules` (`SCIdSchedule`, `SCTime`, `SCActive`) VALUES
  (1, '08:00:00', 1),
  (2, '08:30:00', 1),
  (3, '09:00:00', 1),
  (4, '09:30:00', 1),
  (5, '10:00:00', 1),
  (6, '10:30:00', 1),
  (7, '11:00:00', 1),
  (8, '11:30:00', 1),
  (9, '12:00:00', 1),
  (10, '12:30:00', 1),
  (11, '13:00:00', 1),
  (12, '13:30:00', 1),
  (13, '14:00:00', 1),
  (14, '14:30:00', 1),
  (15, '15:00:00', 1),
  (16, '15:30:00', 1),
  (17, '16:00:00', 1),
  (18, '16:30:00', 1),
  (19, '17:00:00', 1);

INSERT INTO `SERVICES` (`SEIdService`, `SEName`, `SEDescription`, `SEMilesRecom`, `SETimeRecom`, `SEPriceRef`, `SEState`, `SEDetails`) VALUES
  (1, 'Cambio de aceite del motor', 'Sustitución del aceite para mantener lubricadas las piezas internas del motor.', NULL, NULL, NULL, 1, NULL),
  (2, 'Cambio de filtro de aceite', 'Reemplazo del filtro que retiene impurezas del aceite, cuando corresponda al modelo.', NULL, NULL, NULL, 1, NULL),
  (3, 'Limpieza o cambio de filtro de aire', 'Revisión del filtro y limpieza o sustitución según su tipo y condición.', NULL, NULL, NULL, 1, NULL),
  (4, 'Revisión de bujía', 'Inspección y cambio de la bujía cuando presente desgaste o fallas.', NULL, NULL, NULL, 1, NULL),
  (5, 'Revisión de frenos', 'Inspección de pastillas, zapatas, discos y funcionamiento del sistema.', NULL, NULL, NULL, 1, NULL),
  (6, 'Cambio de líquido de frenos', 'Sustitución del líquido en motocicletas con frenos hidráulicos.', NULL, NULL, NULL, 1, NULL),
  (7, 'Ajuste y lubricación de cadena', 'Limpieza, lubricación y ajuste de la tensión de la cadena.', NULL, NULL, NULL, 1, NULL),
  (8, 'Revisión del kit de arrastre', 'Inspección del desgaste de cadena, piñón y corona.', NULL, NULL, NULL, 1, NULL),
  (9, 'Revisión de neumáticos', 'Verificación de presión, desgaste y posibles daños.', NULL, NULL, NULL, 1, NULL),
  (10, 'Revisión de batería', 'Comprobación de carga, terminales y estado general.', NULL, NULL, NULL, 1, NULL),
  (11, 'Revisión de luces y sistema eléctrico', 'Verificación de luces, direccionales, bocina y conexiones.', NULL, NULL, NULL, 1, NULL),
  (12, 'Ajuste de embrague y acelerador', 'Revisión del funcionamiento y ajuste de cables, cuando corresponda.', NULL, NULL, NULL, 1, NULL),
  (13, 'Revisión de suspensión', 'Inspección de amortiguadores, horquilla y posibles fugas.', NULL, NULL, NULL, 1, NULL),
  (14, 'Revisión del sistema de refrigeración', 'Inspección de refrigerante, mangueras y fugas en modelos que utilicen este sistema.', NULL, NULL, NULL, 1, NULL),
  (15, 'Ajuste de válvulas', 'Verificación y ajuste de la holgura según las especificaciones del motor.', NULL, NULL, NULL, 1, NULL),
  (16, 'Mantenimiento general', 'Conjunto de revisiones y servicios definidos por el taller para cada motocicleta.', NULL, NULL, NULL, 1, NULL);

INSERT INTO `NOTIFICATION_SETTING` (`NSType`, `NSEnabled`, `NSLeadDays`) VALUES
  ('APPOINTMENT_CANCELLED', 1, NULL),
  ('APPOINTMENT_NO_SHOW', 1, NULL),
  ('APPOINTMENT_RESCHEDULED', 1, NULL),
  ('EMAIL_FAILED', 1, NULL),
  ('MAINTENANCE_OVERDUE', 1, 0),
  ('MAINTENANCE_UPCOMING', 1, 3),
  ('PLATE_READY', 1, NULL),
  ('PROCEDURE_STALLED', 1, 7);

COMMIT;

import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import pool from "../config/database.js";
import { NotificationType } from "../enums/notification.enum.js";

export interface NotificationSetting {
  type: NotificationType;
  enabled: boolean;
  leadDays: number | null;
}

export interface AdminNotification {
  id: number;
  type: NotificationType;
  title: string;
  message: string;
  entity: string | null;
  entityId: number | null;
  read: boolean;
  createdAt: string;
}

export interface NotificationPage {
  notifications: AdminNotification[];
  unread: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

// Tipos que usan días de anticipación / espera; el resto no admite leadDays.
const LEAD_DAY_TYPES: ReadonlySet<NotificationType> = new Set([
  NotificationType.MAINTENANCE_UPCOMING,
  NotificationType.MAINTENANCE_OVERDUE,
  NotificationType.PROCEDURE_STALLED,
]);
const MAX_LEAD_DAYS = 365;

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (Object.values(NotificationType) as string[]).includes(value);
}

export async function getNotificationSettings(): Promise<NotificationSetting[]> {
  const [rows] = await pool.execute<Array<RowDataPacket & { type: NotificationType; enabled: number; leadDays: number | null }>>(`
    SELECT NSType AS type, NSEnabled AS enabled, NSLeadDays AS leadDays
    FROM NOTIFICATION_SETTING
    ORDER BY NSType
  `);
  return rows.map((row) => ({ type: row.type, enabled: row.enabled === 1, leadDays: row.leadDays }));
}

export async function updateNotificationSetting(
  type: NotificationType,
  changes: { enabled?: boolean; leadDays?: number },
): Promise<boolean> {
  if (changes.leadDays !== undefined) {
    if (!LEAD_DAY_TYPES.has(type)) throw new TypeError("Notification type has no lead days");
    if (!Number.isInteger(changes.leadDays) || changes.leadDays < 0 || changes.leadDays > MAX_LEAD_DAYS) {
      throw new RangeError("Invalid lead days");
    }
  }
  const [result] = await pool.execute<ResultSetHeader>(`
    UPDATE NOTIFICATION_SETTING
    SET NSEnabled = COALESCE(?, NSEnabled), NSLeadDays = COALESCE(?, NSLeadDays)
    WHERE NSType = ?
  `, [changes.enabled === undefined ? null : Number(changes.enabled), changes.leadDays ?? null, type]);
  return result.affectedRows > 0;
}

export async function getNotifications(page: number, pageSize: number, unreadOnly: boolean): Promise<NotificationPage> {
  const where = unreadOnly ? "WHERE NOReadAt IS NULL" : "";
  const [counts] = await pool.execute<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM NOTIFICATION ${where}`,
  );
  const [unreadRows] = await pool.execute<Array<RowDataPacket & { unread: number }>>(
    `SELECT COUNT(*) AS unread FROM NOTIFICATION WHERE NOReadAt IS NULL`,
  );
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & {
    id: number; type: NotificationType; title: string; message: string;
    entity: string | null; entityId: number | null; readAt: string | null; createdAt: string;
  }>>(`
    SELECT NOIdNotification AS id, NOType AS type, NOTitle AS title, NOMessage AS message,
           NOEntity AS entity, NOEntityId AS entityId, NOReadAt AS readAt,
           DATE_FORMAT(NOCreatedAt, '%Y-%m-%d %H:%i:%s') AS createdAt
    FROM NOTIFICATION ${where}
    ORDER BY NOCreatedAt DESC, NOIdNotification DESC
    LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return {
    notifications: rows.map((row) => ({
      id: row.id,
      type: row.type,
      title: row.title,
      message: row.message,
      entity: row.entity,
      entityId: row.entityId,
      read: row.readAt !== null,
      createdAt: row.createdAt,
    })),
    unread: Number(unreadRows[0]?.unread ?? 0),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

export async function markNotificationRead(id: number): Promise<boolean> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE NOTIFICATION SET NOReadAt = COALESCE(NOReadAt, NOW()) WHERE NOIdNotification = ?`,
    [id],
  );
  return result.affectedRows > 0;
}

export async function markAllNotificationsRead(): Promise<number> {
  const [result] = await pool.execute<ResultSetHeader>(
    `UPDATE NOTIFICATION SET NOReadAt = NOW() WHERE NOReadAt IS NULL`,
  );
  return result.affectedRows;
}

// Eventos de citas: se llaman desde el servicio de citas con la misma conexión/transacción.
type Executor = Pick<PoolConnection, "execute">;

export async function notifyAppointmentEvent(
  executor: Executor,
  type: NotificationType.APPOINTMENT_CANCELLED | NotificationType.APPOINTMENT_RESCHEDULED | NotificationType.APPOINTMENT_NO_SHOW,
  appointmentId: number,
): Promise<void> {
  const label = {
    [NotificationType.APPOINTMENT_CANCELLED]: ["Cita cancelada", "canceló su cita"] as const,
    [NotificationType.APPOINTMENT_RESCHEDULED]: ["Cita reprogramada", "reprogramó su cita"] as const,
    [NotificationType.APPOINTMENT_NO_SHOW]: ["Cliente no asistió", "no asistió a su cita"] as const,
  }[type];
  await executor.execute(`
    INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
    SELECT NS.NSType, ?,
           CONCAT(COALESCE(NULLIF(TRIM(CONCAT_WS(' ', CU.CUName, CU.CULastName)), ''), 'Cliente'),
                  ' ', ?, ' del ', DATE_FORMAT(MAP.MAPDate, '%Y-%m-%d'),
                  ' ', TIME_FORMAT(SC.SCTime, '%H:%i'), ' en ', AG.AGName, '.'),
           'APPOINTMENT', MAP.MAPIdAppointment,
           CONCAT(NS.NSType, ':', MAP.MAPIdAppointment, ':', DATE_FORMAT(MAP.MAPDate, '%Y%m%d'), ':', MAP.MAIdSchedule)
    FROM NOTIFICATION_SETTING NS
    JOIN MAINTENANCE_APPOINTMENT MAP ON MAP.MAPIdAppointment = ?
    JOIN MOTORCYCLES MO ON MO.MOIdMoto = MAP.MOIdMoto
    LEFT JOIN CUSTOMER CU ON CU.CUIdCustomer = MO.CUIdCustomer
    JOIN AGENCIES AG ON AG.AGIdAgencie = MAP.MAIdAgencie
    JOIN SCHEDULES SC ON SC.SCIdSchedule = MAP.MAIdSchedule
    WHERE NS.NSType = ? AND NS.NSEnabled = 1
  `, [label[0], label[1], appointmentId, type]);
}

const SCAN_STATEMENTS: ReadonlyArray<{ type: NotificationType; sql: string }> = [
  {
    type: NotificationType.MAINTENANCE_UPCOMING,
    sql: `
      INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
      SELECT NS.NSType, 'Mantenimiento próximo',
             CONCAT('La moto ', CONCAT_WS(' ', MO.MOBrand, MO.MOModel), COALESCE(CONCAT(' (', NULLIF(TRIM(MO.MOPlate), ''), ')'), ''),
                    ' tiene mantenimiento el ', DATE_FORMAT(STR_TO_DATE(MA.MANextDate, '%Y-%m-%d'), '%Y-%m-%d'), '.'),
             'MAINTENANCE', MA.MAMaintenance, CONCAT(NS.NSType, ':', MA.MAMaintenance)
      FROM NOTIFICATION_SETTING NS
      JOIN MAINTENANCE MA ON MA.MAMaintenance = (SELECT MAX(M2.MAMaintenance) FROM MAINTENANCE M2 WHERE M2.MOIdMoto = MA.MOIdMoto)
      JOIN MOTORCYCLES MO ON MO.MOIdMoto = MA.MOIdMoto
      WHERE NS.NSType = 'MAINTENANCE_UPCOMING' AND NS.NSEnabled = 1
        AND STR_TO_DATE(MA.MANextDate, '%Y-%m-%d') BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL COALESCE(NS.NSLeadDays, 0) DAY)`,
  },
  {
    type: NotificationType.MAINTENANCE_OVERDUE,
    sql: `
      INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
      SELECT NS.NSType, 'Mantenimiento vencido',
             CONCAT('La moto ', CONCAT_WS(' ', MO.MOBrand, MO.MOModel), COALESCE(CONCAT(' (', NULLIF(TRIM(MO.MOPlate), ''), ')'), ''),
                    ' tenía mantenimiento el ', DATE_FORMAT(STR_TO_DATE(MA.MANextDate, '%Y-%m-%d'), '%Y-%m-%d'), '.'),
             'MAINTENANCE', MA.MAMaintenance, CONCAT(NS.NSType, ':', MA.MAMaintenance)
      FROM NOTIFICATION_SETTING NS
      JOIN MAINTENANCE MA ON MA.MAMaintenance = (SELECT MAX(M2.MAMaintenance) FROM MAINTENANCE M2 WHERE M2.MOIdMoto = MA.MOIdMoto)
      JOIN MOTORCYCLES MO ON MO.MOIdMoto = MA.MOIdMoto
      WHERE NS.NSType = 'MAINTENANCE_OVERDUE' AND NS.NSEnabled = 1
        AND STR_TO_DATE(MA.MANextDate, '%Y-%m-%d') < DATE_SUB(CURDATE(), INTERVAL COALESCE(NS.NSLeadDays, 0) DAY)`,
  },
  {
    type: NotificationType.PLATE_READY,
    sql: `
      INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
      SELECT NS.NSType, 'Placas listas para entregar',
             CONCAT('Las placas de la moto ', CONCAT_WS(' ', MO.MOBrand, MO.MOModel), ' (chasis/VIN ',
                    COALESCE(NULLIF(MO.MOVin, ''), 'sin dato'), ') están en Mototec.'),
             'PLATE', MO.MOIdMoto, CONCAT(NS.NSType, ':', MO.MOIdMoto)
      FROM NOTIFICATION_SETTING NS
      JOIN PROCESSING P ON P.PRIdProcess = (SELECT MAX(P2.PRIdProcess) FROM PROCESSING P2 WHERE P2.MOIdMoto = P.MOIdMoto)
      JOIN STATE_PLATE SP ON SP.STIdState = P.STIdState
      JOIN MOTORCYCLES MO ON MO.MOIdMoto = P.MOIdMoto
      WHERE NS.NSType = 'PLATE_READY' AND NS.NSEnabled = 1
        AND SP.STState = 'Placas recibidas en Mototec'
        AND (MO.MOPlate IS NULL OR TRIM(MO.MOPlate) = '')`,
  },
  {
    type: NotificationType.PROCEDURE_STALLED,
    sql: `
      INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
      SELECT NS.NSType, 'Trámite sin avance',
             CONCAT('El trámite de placas de ', CONCAT_WS(' ', MO.MOBrand, MO.MOModel), ' sigue en "', SP.STState,
                    '" desde el ', DATE_FORMAT(STR_TO_DATE(P.PRDateUpdate, '%Y-%m-%d'), '%Y-%m-%d'), '.'),
             'PLATE', MO.MOIdMoto, CONCAT(NS.NSType, ':', P.PRIdProcess, ':', P.PRDateUpdate)
      FROM NOTIFICATION_SETTING NS
      JOIN PROCESSING P ON P.PRIdProcess = (SELECT MAX(P2.PRIdProcess) FROM PROCESSING P2 WHERE P2.MOIdMoto = P.MOIdMoto)
      JOIN STATE_PLATE SP ON SP.STIdState = P.STIdState
      JOIN MOTORCYCLES MO ON MO.MOIdMoto = P.MOIdMoto
      WHERE NS.NSType = 'PROCEDURE_STALLED' AND NS.NSEnabled = 1
        AND SP.STState <> 'Placas recibidas en Mototec'
        AND STR_TO_DATE(P.PRDateUpdate, '%Y-%m-%d') <= DATE_SUB(CURDATE(), INTERVAL COALESCE(NS.NSLeadDays, 0) DAY)`,
  },
  {
    type: NotificationType.EMAIL_FAILED,
    sql: `
      INSERT INTO NOTIFICATION (NOType, NOTitle, NOMessage, NOEntity, NOEntityId, NODedupeKey)
      SELECT NS.NSType, 'Correo no enviado',
             CONCAT('No se pudo enviar el recordatorio "', R.RETitle, '" programado para ', R.REDateProgram, '.'),
             'REMINDER', R.REIdReminder, CONCAT(NS.NSType, ':', R.REIdReminder)
      FROM NOTIFICATION_SETTING NS
      JOIN REMINDER R ON R.REState = 3
      WHERE NS.NSType = 'EMAIL_FAILED' AND NS.NSEnabled = 1`,
  },
];

export async function generateScheduledNotifications(): Promise<void> {
  for (const statement of SCAN_STATEMENTS) {
    try {
      await pool.execute(statement.sql);
    } catch (error: unknown) {
      console.error(`Error generando avisos ${statement.type}`, error);
    }
  }
}

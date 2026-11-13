import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { ReminderState } from "../enums/reminder.enum.js";

export type ReminderHistoryStatus = "PENDING" | "SENT" | "ERROR";
export type ReminderHistoryOrigin = "AUTOMATIC" | "MANUAL";

export interface ReminderHistoryFilters {
  page: number;
  pageSize: number;
  search?: string | undefined;
  status?: ReminderHistoryStatus | undefined;
  type?: string | undefined;
  origin?: ReminderHistoryOrigin | undefined;
  dateFrom?: string | undefined;
  dateTo?: string | undefined;
}

interface HistoryRow extends RowDataPacket {
  id: number;
  recipientName: string | null;
  recipientEmail: string | null;
  subject: string;
  type: string;
  state: number;
  origin: ReminderHistoryOrigin;
  administrator: string | null;
  scheduledAt: Date | string;
  attemptedAt: Date | string | null;
  sentAt: Date | string | null;
  content: string;
  error: string | null;
}

interface CountRow extends RowDataPacket { total: number }
interface StatsRow extends RowDataPacket { pending: number; sent: number; error: number }

const stateNumber = (status: ReminderHistoryStatus): number =>
  status === "SENT" ? ReminderState.SENT : status === "ERROR" ? ReminderState.ERROR : ReminderState.PENDING;

function publicError(value: string | null): string | null {
  if (!value) return null;
  return value
    .replace(/(password|token|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[protegido]")
    .slice(0, 500);
}

function whereClause(filters: ReminderHistoryFilters): { sql: string; values: Array<string | number> } {
  const conditions = ["R.REFSend = 'EMAIL'"];
  const values: Array<string | number> = [];
  if (filters.search) {
    conditions.push("(CONCAT_WS(' ', COALESCE(C.CUName, MC.CUName), COALESCE(C.CULastName, MC.CULastName)) LIKE ? OR COALESCE(R.RERecipient, C.CUMail, MC.CUMail, '') LIKE ? OR R.RETitle LIKE ?)");
    const term = `%${filters.search}%`;
    values.push(term, term, term);
  }
  if (filters.status === "PENDING") conditions.push("R.REState IN (1, 4)");
  else if (filters.status) { conditions.push("R.REState = ?"); values.push(stateNumber(filters.status)); }
  if (filters.type) { conditions.push("R.REType = ?"); values.push(filters.type); }
  if (filters.origin) { conditions.push(filters.origin === "MANUAL" ? "R.REType = 'CUSTOM'" : "R.REType <> 'CUSTOM'"); }
  if (filters.dateFrom) { conditions.push("COALESCE(R.REAttemptedAt, R.REDateProgram) >= ?"); values.push(`${filters.dateFrom} 00:00:00`); }
  if (filters.dateTo) { conditions.push("COALESCE(R.REAttemptedAt, R.REDateProgram) < DATE_ADD(?, INTERVAL 1 DAY)"); values.push(`${filters.dateTo} 00:00:00`); }
  return { sql: `WHERE ${conditions.join(" AND ")}`, values };
}

const joins = `
  FROM REMINDER R
  LEFT JOIN CUSTOMER C ON C.CUIdCustomer = R.CUIdCustomer
  LEFT JOIN MAINTENANCE MA ON MA.MAMaintenance = R.MAMaintenance
  LEFT JOIN MOTORCYCLES MO ON MO.MOIdMoto = MA.MOIdMoto
  LEFT JOIN CUSTOMER MC ON MC.CUIdCustomer = MO.CUIdCustomer
  LEFT JOIN USERS U ON U.USId = R.USId`;

function mapRow(row: HistoryRow) {
  return {
    id: Number(row.id),
    recipient: { name: row.recipientName?.trim() || null, email: row.recipientEmail || null },
    subject: row.subject,
    type: row.type,
    status: row.state === ReminderState.SENT ? "SENT" : row.state === ReminderState.ERROR ? "ERROR" : "PENDING",
    origin: row.origin,
    administrator: row.administrator?.trim() || null,
    scheduledAt: row.scheduledAt,
    attemptedAt: row.attemptedAt,
    sentAt: row.sentAt,
    content: row.content,
    error: publicError(row.error),
  };
}

export async function listReminderHistory(filters: ReminderHistoryFilters) {
  const where = whereClause(filters);
  const offset = (filters.page - 1) * filters.pageSize;
  const select = `SELECT R.REIdReminder id,
    NULLIF(TRIM(CONCAT_WS(' ', COALESCE(C.CUName, MC.CUName), COALESCE(C.CULastName, MC.CULastName))), '') recipientName,
    COALESCE(R.RERecipient, C.CUMail, MC.CUMail) recipientEmail,
    R.RETitle subject, R.REType type, R.REState state,
    IF(R.REType = 'CUSTOM', 'MANUAL', 'AUTOMATIC') origin,
    NULLIF(TRIM(CONCAT_WS(' ', U.USName, U.USLastName)), '') administrator,
    R.REDateProgram scheduledAt, R.REAttemptedAt attemptedAt, R.RESentAt sentAt,
    R.REDescription content, R.REError error`;
  const [countResult, statsResult, rowsResult] = await Promise.all([
    pool.execute<CountRow[]>(`SELECT COUNT(*) total ${joins} ${where.sql}`, where.values),
    pool.execute<StatsRow[]>(`SELECT
      SUM(R.REState IN (1, 4)) pending,
      SUM(R.REState = 2) sent,
      SUM(R.REState = 3) error ${joins} WHERE R.REFSend = 'EMAIL'`),
    pool.execute<HistoryRow[]>(`${select} ${joins} ${where.sql}
      ORDER BY COALESCE(R.REAttemptedAt, R.REDateProgram) DESC, R.REIdReminder DESC
      LIMIT ${filters.pageSize} OFFSET ${offset}`, where.values),
  ]);
  const count = countResult[0][0];
  const stats = statsResult[0][0];
  const rows = rowsResult[0];
  const total = Number(count?.total ?? 0);
  return {
    messages: rows.map(mapRow),
    stats: { pending: Number(stats?.pending ?? 0), sent: Number(stats?.sent ?? 0), error: Number(stats?.error ?? 0) },
    pagination: { page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.max(1, Math.ceil(total / filters.pageSize)) },
  };
}

export async function getReminderHistoryDetail(id: number) {
  const [rows] = await pool.execute<HistoryRow[]>(`SELECT R.REIdReminder id,
    NULLIF(TRIM(CONCAT_WS(' ', COALESCE(C.CUName, MC.CUName), COALESCE(C.CULastName, MC.CULastName))), '') recipientName,
    COALESCE(R.RERecipient, C.CUMail, MC.CUMail) recipientEmail,
    R.RETitle subject, R.REType type, R.REState state,
    IF(R.REType = 'CUSTOM', 'MANUAL', 'AUTOMATIC') origin,
    NULLIF(TRIM(CONCAT_WS(' ', U.USName, U.USLastName)), '') administrator,
    R.REDateProgram scheduledAt, R.REAttemptedAt attemptedAt, R.RESentAt sentAt,
    R.REDescription content, R.REError error ${joins}
    WHERE R.REIdReminder = ? AND R.REFSend = 'EMAIL' LIMIT 1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}

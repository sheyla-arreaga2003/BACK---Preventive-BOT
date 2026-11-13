import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import { ReminderState, ReminderType } from "../enums/reminder.enum.js";
import { sendCustomReminderEmail } from "./reminder.service.js";

export type ReminderDelivery = "now" | "scheduled";

interface CustomerMailRow extends RowDataPacket {
  CUIdCustomer: number;
  CUName: string;
  CULastName: string;
  CUMail: string | null;
}

interface ExistingReminderRow extends RowDataPacket {
  REIdReminder: number;
  REState: number;
}

export interface CreatePersonalReminderInput {
  customerId: number;
  adminUserId: number;
  subject: string;
  message: string;
  delivery: ReminderDelivery;
  scheduledAt: string | null;
  requestId: string;
}

export interface PersonalReminderResult {
  id: number;
  status: "PENDING" | "SENT" | "ERROR";
  duplicate: boolean;
}

const stateName = (state: number): PersonalReminderResult["status"] =>
  state === ReminderState.SENT ? "SENT" : state === ReminderState.ERROR ? "ERROR" : "PENDING";

export async function createPersonalReminder(input: CreatePersonalReminderInput): Promise<PersonalReminderResult> {
  const [customers] = await pool.execute<CustomerMailRow[]>(
    `SELECT CUIdCustomer, CUName, CULastName, CUMail FROM CUSTOMER WHERE CUIdCustomer = ? LIMIT 1`,
    [input.customerId],
  );
  const customer = customers[0];
  if (!customer) throw Object.assign(new Error("Cliente no encontrado"), { status: 404 });
  if (!customer.CUMail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.CUMail)) {
    throw Object.assign(new Error("El cliente no tiene un correo electrónico válido"), { status: 422 });
  }

  const programmedAt = input.delivery === "now"
    ? new Date()
    : new Date(`${input.scheduledAt}:00-06:00`);
  if (Number.isNaN(programmedAt.getTime())) throw Object.assign(new Error("La fecha programada no es válida"), { status: 400 });
  if (input.delivery === "scheduled" && programmedAt.getTime() <= Date.now()) {
    throw Object.assign(new Error("La fecha programada debe ser futura"), { status: 400 });
  }

  let reminderId: number;
  try {
    const initialState = input.delivery === "now" ? ReminderState.PROCESSING : ReminderState.PENDING;
    const [result] = await pool.execute<ResultSetHeader>(`
      INSERT INTO REMINDER
        (MAMaintenance, CUIdCustomer, USId, REDateProgram, REType, REState,
         REFSend, RERecipient, RERequestKey, REDescription, RETitle)
      VALUES (NULL, ?, ?, ?, ?, ?, 'EMAIL', ?, ?, ?, ?)
    `, [input.customerId, input.adminUserId, programmedAt, ReminderType.CUSTOM,
      initialState, customer.CUMail, input.requestId, input.message, input.subject]);
    reminderId = result.insertId;
  } catch (error) {
    if (!(typeof error === "object" && error !== null && "code" in error && error.code === "ER_DUP_ENTRY")) throw error;
    const [existing] = await pool.execute<ExistingReminderRow[]>(
      `SELECT REIdReminder, REState FROM REMINDER WHERE RERequestKey = ? LIMIT 1`, [input.requestId]);
    if (!existing[0]) throw error;
    return { id: existing[0].REIdReminder, status: stateName(existing[0].REState), duplicate: true };
  }

  if (input.delivery === "scheduled") return { id: reminderId, status: "PENDING", duplicate: false };

  try {
    await sendCustomReminderEmail({ to: customer.CUMail, subject: input.subject, message: input.message });
    await pool.execute(`UPDATE REMINDER SET REState = ?, REAttemptedAt = NOW(), RESentAt = NOW(), REError = NULL WHERE REIdReminder = ? AND REState = ?`,
      [ReminderState.SENT, reminderId, ReminderState.PROCESSING]);
    return { id: reminderId, status: "SENT", duplicate: false };
  } catch (error) {
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 250);
    await pool.execute(`UPDATE REMINDER SET REState = ?, REAttemptedAt = NOW(), RETries = RETries + 1, REError = ? WHERE REIdReminder = ?`,
      [ReminderState.ERROR, message, reminderId]);
    throw Object.assign(new Error("No se pudo enviar el correo. El intento quedó registrado"), { status: 502, reminderId });
  }
}

export async function getSentReminderCount(): Promise<number> {
  const [rows] = await pool.execute<Array<RowDataPacket & { total: number }>>(
    `SELECT COUNT(*) AS total FROM REMINDER WHERE REState = ? AND RESentAt IS NOT NULL`, [ReminderState.SENT]);
  return Number(rows[0]?.total ?? 0);
}

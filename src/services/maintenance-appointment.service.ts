import type { ResultSetHeader, RowDataPacket } from "mysql2";
import pool from "../config/database.js";

interface AgencyRow extends RowDataPacket { id: number; name: string }
interface ScheduleRow extends RowDataPacket { id: number; time: string }
interface AppointmentServiceRow extends RowDataPacket { appointmentId: number; id: number; name: string; description: string }
export interface AppointmentRequestedService { id: number; name: string; description: string }
interface AppointmentRow extends RowDataPacket {
  id: number;
  motorcycleId: number;
  motorcycle: string;
  plate: string | null;
  customer: string;
  agency: string;
  date: string;
  time: string;
  mileage: string | null;
  observations: string | null;
  status: "PROGRAMADO";
}

export interface MaintenanceAppointment {
  id: number;
  motorcycleId: number;
  motorcycle: string;
  plate: string | null;
  customer: string;
  agency: string;
  date: string;
  time: string;
  mileage: string | null;
  observations: string | null;
  status: "PROGRAMADO";
  services: AppointmentRequestedService[];
}

export interface AppointmentPage {
  appointments: MaintenanceAppointment[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function mapAppointment(row: AppointmentRow, services: AppointmentRequestedService[] = []): MaintenanceAppointment {
  return {
    id: row.id,
    motorcycleId: row.motorcycleId,
    motorcycle: row.motorcycle,
    plate: row.plate?.trim() || null,
    customer: row.customer,
    agency: row.agency,
    date: row.date,
    time: row.time,
    mileage: row.mileage,
    observations: row.observations,
    status: row.status,
    services,
  };
}

export async function getAppointmentServices(): Promise<AppointmentRequestedService[]> {
  const [rows] = await pool.execute<Array<RowDataPacket & AppointmentRequestedService>>(`
    SELECT SEIdService AS id, SEName AS name, SEDescription AS description
    FROM SERVICES
    WHERE COALESCE(SEState, 1) = 1
    ORDER BY SEName
  `);
  return rows;
}

export async function getAppointmentAgencies(): Promise<Array<{ id: number; name: string }>> {
  const [rows] = await pool.execute<AgencyRow[]>(`
    SELECT AGIdAgencie AS id, AGName AS name
    FROM AGENCIES
    WHERE AGActive = 1
    ORDER BY AGName
  `);
  return rows;
}

export async function getAvailableAppointmentSchedules(
  agencyId: number,
  date: string,
): Promise<Array<{ id: number; time: string }>> {
  const [rows] = await pool.execute<ScheduleRow[]>(`
    SELECT SC.SCIdSchedule AS id, TIME_FORMAT(SC.SCTime, '%H:%i:%s') AS time
    FROM SCHEDULES SC
    WHERE SC.SCActive = 1
      AND EXISTS (
        SELECT 1 FROM AGENCIES AG
        WHERE AG.AGIdAgencie = ? AND AG.AGActive = 1
      )
      AND NOT EXISTS (
        SELECT 1 FROM MAINTENANCE MA
        WHERE MA.MAIdAgencie = ?
          AND MA.MADate = ?
          AND MA.MAIdSchedule = SC.SCIdSchedule
      )
      AND NOT EXISTS (
        SELECT 1 FROM MAINTENANCE_APPOINTMENT MAP
        WHERE MAP.MAIdAgencie = ?
          AND MAP.MAPDate = ?
          AND MAP.MAIdSchedule = SC.SCIdSchedule
          AND MAP.MAPStatus = 'PROGRAMADO'
      )
    ORDER BY SC.SCTime
  `, [agencyId, agencyId, date, agencyId, date]);
  return rows;
}

export async function createClientMaintenanceAppointment(input: {
  motorcycleId: number;
  agencyId: number;
  scheduleId: number;
  date: string;
  mileage: string;
  observations: string | null;
  serviceIds: number[];
}): Promise<{ id: number }> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [valid] = await connection.execute<RowDataPacket[]>(`
      SELECT MO.MOIdMoto
      FROM MOTORCYCLES MO
      JOIN AGENCIES AG ON AG.AGIdAgencie = ? AND AG.AGActive = 1
      JOIN SCHEDULES SC ON SC.SCIdSchedule = ? AND SC.SCActive = 1
      WHERE MO.MOIdMoto = ?
      LIMIT 1
    `, [input.agencyId, input.scheduleId, input.motorcycleId]);
    if (valid.length === 0) throw new TypeError("Invalid appointment data");

    if (input.serviceIds.length === 0) throw new TypeError("At least one service is required");
    const placeholders = input.serviceIds.map(() => "?").join(", ");
    const [services] = await connection.execute<RowDataPacket[]>(`
      SELECT SEIdService FROM SERVICES
      WHERE SEIdService IN (${placeholders}) AND COALESCE(SEState, 1) = 1
    `, input.serviceIds);
    if (services.length !== input.serviceIds.length) throw new TypeError("Invalid services");

    const [occupied] = await connection.execute<RowDataPacket[]>(`
      SELECT MAMaintenance
      FROM MAINTENANCE
      WHERE MAIdAgencie = ? AND MADate = ? AND MAIdSchedule = ?
      LIMIT 1
      FOR UPDATE
    `, [input.agencyId, input.date, input.scheduleId]);
    if (occupied.length > 0) throw new RangeError("Appointment slot unavailable");

    const [result] = await connection.execute<ResultSetHeader>(`
      INSERT INTO MAINTENANCE_APPOINTMENT
        (MOIdMoto, MAIdAgencie, MAIdSchedule, MAPDate, MAPMileage, MAPObservations)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [input.motorcycleId, input.agencyId, input.scheduleId, input.date, input.mileage, input.observations]);
    for (const serviceId of input.serviceIds) {
      await connection.execute(
        "INSERT INTO MAINTENANCE_APPOINTMENT_SERVICE (MAPIdAppointment, SEIdService) VALUES (?, ?)",
        [result.insertId, serviceId],
      );
    }
    await connection.commit();
    return { id: result.insertId };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

const appointmentSelect = `
  SELECT MAP.MAPIdAppointment AS id,
         MO.MOIdMoto AS motorcycleId,
         CONCAT_WS(' ', MO.MOBrand, MO.MOModel) AS motorcycle,
         NULLIF(TRIM(MO.MOPlate), '') AS plate,
         CONCAT_WS(' ', CU.CUName, CU.CULastName) AS customer,
         AG.AGName AS agency,
         DATE_FORMAT(MAP.MAPDate, '%Y-%m-%d') AS date,
         TIME_FORMAT(SC.SCTime, '%H:%i:%s') AS time,
         MAP.MAPMileage AS mileage,
         MAP.MAPObservations AS observations,
         MAP.MAPStatus AS status
  FROM MAINTENANCE_APPOINTMENT MAP
  JOIN MOTORCYCLES MO ON MO.MOIdMoto = MAP.MOIdMoto
  LEFT JOIN CUSTOMER CU ON CU.CUIdCustomer = MO.CUIdCustomer
  JOIN AGENCIES AG ON AG.AGIdAgencie = MAP.MAIdAgencie
  JOIN SCHEDULES SC ON SC.SCIdSchedule = MAP.MAIdSchedule
`;

async function mapAppointmentsWithServices(rows: AppointmentRow[]): Promise<MaintenanceAppointment[]> {
  const ids = rows.map((row) => row.id);
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(", ");
  const [serviceRows] = await pool.execute<AppointmentServiceRow[]>(`
    SELECT MAS.MAPIdAppointment AS appointmentId,
           SE.SEIdService AS id, SE.SEName AS name, SE.SEDescription AS description
    FROM MAINTENANCE_APPOINTMENT_SERVICE MAS
    INNER JOIN SERVICES SE ON SE.SEIdService = MAS.SEIdService
    WHERE MAS.MAPIdAppointment IN (${placeholders})
    ORDER BY SE.SEName
  `, ids);
  const byAppointment = new Map<number, AppointmentRequestedService[]>();
  for (const service of serviceRows) {
    const current = byAppointment.get(service.appointmentId) ?? [];
    current.push({ id: service.id, name: service.name, description: service.description });
    byAppointment.set(service.appointmentId, current);
  }
  return rows.map((row) => mapAppointment(row, byAppointment.get(row.id) ?? []));
}

export async function getClientMaintenanceAppointments(motorcycleId: number): Promise<MaintenanceAppointment[]> {
  const [rows] = await pool.execute<AppointmentRow[]>(`${appointmentSelect}
    WHERE MAP.MOIdMoto = ? AND MAP.MAPStatus = 'PROGRAMADO'
    ORDER BY MAP.MAPDate, SC.SCTime, MAP.MAPIdAppointment
  `, [motorcycleId]);
  return mapAppointmentsWithServices(rows);
}

export async function getAdminMaintenanceAppointments(page: number, pageSize: number): Promise<AppointmentPage> {
  const [counts] = await pool.execute<Array<RowDataPacket & { total: number }>>(`
    SELECT COUNT(*) AS total FROM MAINTENANCE_APPOINTMENT WHERE MAPStatus = 'PROGRAMADO'
  `);
  const total = counts[0]?.total ?? 0;
  const [rows] = await pool.query<AppointmentRow[]>(`${appointmentSelect}
    WHERE MAP.MAPStatus = 'PROGRAMADO'
    ORDER BY MAP.MAPDate, SC.SCTime, MAP.MAPIdAppointment
    LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return {
    appointments: await mapAppointmentsWithServices(rows),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

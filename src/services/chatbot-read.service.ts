import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";
import type { MaintenancePage, MotorcycleSummary } from "../interfaces/chatbot.interface.js";
import { WITHOUT_REGISTERED_PLATE_SQL, withoutRegisteredPlateSql } from "./motorcycle-plate-status.service.js";

interface MotorcycleRow extends RowDataPacket {
  MOIdMoto: number;
  MOBrand: string;
  MOModel: string;
  MOYear: string | number;
  MOColor: string;
  MOPlate: string | null;
  STIdState: number | null;
  STState: string | null;
  PRFirstDate: string | null;
}

interface CountRow extends RowDataPacket { total: number }
interface MotorcycleFleetCountRow extends RowDataPacket { total: number; withoutPlate: number }
export interface MotorcycleFleetCount { total: number; withoutPlate: number }
interface MaintenanceRow extends RowDataPacket {
  MAMaintenance: number;
  MADate: string;
  MAMiles: string | null;
  MANextMiles: string | null;
  MANextDate: string | null;
}
interface ServiceRow extends RowDataPacket {
  MAMaintenance: number;
  SEName: string | null;
  SEDescription: string | null;
}

export type MotorcycleResolution =
  | { status: "found"; motorcycleId: number }
  | { status: "not_found" }
  | { status: "ambiguous" };

type InvoiceResolutionQuery = (
  query: string,
  parameters: readonly [string, string],
) => Promise<Array<{ MOIdMoto: number }>>;
type PlateResolutionQuery = (
  query: string,
  parameters: readonly [string],
) => Promise<Array<{ MOIdMoto: number }>>;

const executeInvoiceResolution: InvoiceResolutionQuery = async (query, parameters) => {
  const [rows] = await pool.execute<Array<RowDataPacket & { MOIdMoto: number }>>(query, [...parameters]);
  return rows;
};

const executePlateResolution: PlateResolutionQuery = async (query, parameters) => {
  const [rows] = await pool.execute<Array<RowDataPacket & { MOIdMoto: number }>>(query, [...parameters]);
  return rows;
};

function requireText(value: string, field: string): string {
  const normalized = value.trim();
  if (!normalized) throw new TypeError(`${field} must be a non-empty string`);
  return normalized;
}

function requirePagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1) throw new RangeError("page must be a positive integer");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
    throw new RangeError("pageSize must be between 1 and 20");
  }
}

export async function resolveMotorcycleByInvoice(
  serieInvoice: string,
  numberInvoice: string,
  executeQuery: InvoiceResolutionQuery = executeInvoiceResolution,
): Promise<MotorcycleResolution> {
  const rows = await executeQuery(
    `SELECT MOIdMoto FROM MOTORCYCLES WHERE MOSerieInvoice = ? AND MONumberInvoice = ?`,
    [requireText(serieInvoice, "serieInvoice"), requireText(numberInvoice, "numberInvoice")],
  );
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length > 1) return { status: "ambiguous" };
  const row = rows[0];
  return row ? { status: "found", motorcycleId: row.MOIdMoto } : { status: "not_found" };
}

export async function resolveMotorcycleByPlate(
  plate: string,
  executeQuery: PlateResolutionQuery = executePlateResolution,
): Promise<MotorcycleResolution> {
  const rows = await executeQuery(
    `SELECT MOIdMoto FROM MOTORCYCLES WHERE MOPlate = ?`,
    [requireText(plate, "plate")],
  );
  if (rows.length === 0) return { status: "not_found" };
  if (rows.length > 1) return { status: "ambiguous" };
  const row = rows[0];
  return row ? { status: "found", motorcycleId: row.MOIdMoto } : { status: "not_found" };
}

export async function getMotorcycleSummary(motorcycleId: number): Promise<MotorcycleSummary | null> {
  const [rows] = await pool.execute<MotorcycleRow[]>(`
    SELECT MO.MOIdMoto, MO.MOBrand, MO.MOModel, MO.MOYear, MO.MOColor, MO.MOPlate,
      LP.STIdState, SP.STState, LP.PRFirstDate
    FROM MOTORCYCLES MO
    LEFT JOIN PROCESSING LP ON LP.PRIdProcess = (
      SELECT MAX(P.PRIdProcess) FROM PROCESSING P WHERE P.MOIdMoto = MO.MOIdMoto
    )
    LEFT JOIN STATE_PLATE SP ON SP.STIdState = LP.STIdState
    WHERE MO.MOIdMoto = ?
    LIMIT 1
  `, [motorcycleId]);
  const row = rows[0];
  if (!row) return null;
  return {
    brand: row.MOBrand,
    model: row.MOModel,
    year: String(row.MOYear),
    color: row.MOColor,
    plate: row.MOPlate,
    latestPlateState: row.STIdState !== null && row.STState !== null && row.PRFirstDate !== null
      ? { id: row.STIdState, name: row.STState, registeredDate: row.PRFirstDate }
      : null,
  };
}

export async function getMaintenancePageByMotorcycle(
  motorcycleId: number,
  page: number,
  pageSize: number,
): Promise<MaintenancePage> {
  requirePagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS total FROM MAINTENANCE WHERE MOIdMoto = ?`, [motorcycleId],
  );
  const total = counts[0]?.total ?? 0;
  const [maintenances] = await pool.query<MaintenanceRow[]>(`
    SELECT MAMaintenance, DATE_FORMAT(MADate, '%Y-%m-%d') AS MADate,
      MAMiles, MANextMiles, MANextDate
    FROM MAINTENANCE
    WHERE MOIdMoto = ?
    ORDER BY MADate DESC, MAMaintenance DESC
    LIMIT ? OFFSET ?
  `, [motorcycleId, pageSize, (page - 1) * pageSize]);
  const ids = maintenances.map((item) => item.MAMaintenance);
  let serviceRows: ServiceRow[] = [];
  if (ids.length > 0) {
    const placeholders = ids.map(() => "?").join(", ");
    const [rows] = await pool.execute<ServiceRow[]>(`
      SELECT DM.MAMaintenance, SE.SEName, SE.SEDescription
      FROM DETAIL_MAINTENANCE DM
      LEFT JOIN SERVICES SE ON SE.SEIdService = DM.SEIdService
      WHERE DM.MAMaintenance IN (${placeholders})
      ORDER BY DM.MAMaintenance DESC, DM.DMIdDetail ASC
    `, ids);
    serviceRows = rows;
  }
  const grouped = new Map<number, Array<{ name: string; description: string }>>();
  for (const row of serviceRows) {
    if (row.SEName === null || row.SEDescription === null) continue;
    const items = grouped.get(row.MAMaintenance) ?? [];
    items.push({ name: row.SEName, description: row.SEDescription });
    grouped.set(row.MAMaintenance, items);
  }
  return {
    maintenances: maintenances.map((item) => ({
      date: item.MADate,
      mileage: item.MAMiles,
      nextMileage: item.MANextMiles,
      nextDate: item.MANextDate,
      services: grouped.get(item.MAMaintenance) ?? [],
    })),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

export async function getNextMaintenanceByMotorcycle(motorcycleId: number): Promise<{
  nextMileage: string | null;
  nextDate: string | null;
  sourceMaintenanceDate: string;
} | null> {
  const [rows] = await pool.execute<MaintenanceRow[]>(`
    SELECT MAMaintenance, DATE_FORMAT(MADate, '%Y-%m-%d') AS MADate,
      MAMiles, MANextMiles, MANextDate
    FROM MAINTENANCE
    WHERE MOIdMoto = ? AND (MANextMiles IS NOT NULL OR MANextDate IS NOT NULL)
    ORDER BY MADate DESC, MAMaintenance DESC
    LIMIT 1
  `, [motorcycleId]);
  const row = rows[0];
  return row ? {
    nextMileage: row.MANextMiles,
    nextDate: row.MANextDate,
    sourceMaintenanceDate: row.MADate,
  } : null;
}

export async function getPendingPlates(page: number, pageSize: number): Promise<{
  motorcycles: Array<{ brand: string; model: string; year: string; color: string; latestState: string | null }>;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}> {
  requirePagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(
    `SELECT COUNT(*) AS total FROM MOTORCYCLES WHERE ${WITHOUT_REGISTERED_PLATE_SQL}`,
  );
  const total = counts[0]?.total ?? 0;
  const [rows] = await pool.query<Array<RowDataPacket & {
    MOBrand: string; MOModel: string; MOYear: string | number; MOColor: string; STState: string | null;
  }>>(`
    SELECT MO.MOBrand, MO.MOModel, MO.MOYear, MO.MOColor, SP.STState
    FROM MOTORCYCLES MO
    LEFT JOIN PROCESSING LP ON LP.PRIdProcess = (
      SELECT MAX(P.PRIdProcess) FROM PROCESSING P WHERE P.MOIdMoto = MO.MOIdMoto
    )
    LEFT JOIN STATE_PLATE SP ON SP.STIdState = LP.STIdState
    WHERE ${withoutRegisteredPlateSql("MO.MOPlate")}
    ORDER BY MO.MOIdMoto DESC
    LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return {
    motorcycles: rows.map((row) => ({
      brand: row.MOBrand, model: row.MOModel, year: String(row.MOYear), color: row.MOColor, latestState: row.STState,
    })),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

export interface MotorcycleFleetSummary {
  total: number;
  withPlate: number;
  withoutPlate: number;
}

export type MotorcycleFleetSummaryQuery = (query: string) => Promise<MotorcycleFleetCount[]>;

const executeMotorcycleFleetSummaryQuery: MotorcycleFleetSummaryQuery = async (query) => {
  const [rows] = await pool.execute<MotorcycleFleetCountRow[]>(query);
  return rows;
};

export async function getMotorcycleFleetSummary(
  executeQuery: MotorcycleFleetSummaryQuery = executeMotorcycleFleetSummaryQuery,
): Promise<MotorcycleFleetSummary> {
  const rows = await executeQuery(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN ${WITHOUT_REGISTERED_PLATE_SQL} THEN 1 ELSE 0 END) AS withoutPlate
    FROM MOTORCYCLES
  `);
  const total = Number(rows[0]?.total ?? 0);
  const withoutPlate = Number(rows[0]?.withoutPlate ?? 0);
  return { total, withPlate: total - withoutPlate, withoutPlate };
}

export async function getMaintenancePeriodSummary(startDate: string, endDate: string): Promise<{
  startDate: string;
  endDate: string;
  maintenanceCount: number;
  motorcycleCount: number;
}> {
  const [rows] = await pool.execute<Array<RowDataPacket & { maintenanceCount: number; motorcycleCount: number }>>(`
    SELECT COUNT(*) AS maintenanceCount, COUNT(DISTINCT MOIdMoto) AS motorcycleCount
    FROM MAINTENANCE
    WHERE MADate BETWEEN ? AND ?
  `, [startDate, endDate]);
  return { startDate, endDate, maintenanceCount: rows[0]?.maintenanceCount ?? 0, motorcycleCount: rows[0]?.motorcycleCount ?? 0 };
}

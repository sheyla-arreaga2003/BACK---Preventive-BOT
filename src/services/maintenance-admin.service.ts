import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";

interface CountRow extends RowDataPacket { total: number }
interface MotorcycleRow extends RowDataPacket {
  MOIdMoto: number;
  MOBrand: string;
  MOModel: string;
  MOPlate: string;
  CUIdCustomer: number | null;
  CUName: string | null;
  CULastName: string | null;
}

export interface MaintenanceMotorcycle {
  id: number;
  brand: string;
  model: string;
  plate: string;
  customer: { id: number; name: string } | null;
}

export interface MaintenanceMotorcyclePage {
  motorcycles: MaintenanceMotorcycle[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

function validatePagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1) throw new RangeError("Invalid page");
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) throw new RangeError("Invalid page size");
}

function mapMotorcycle(row: MotorcycleRow): MaintenanceMotorcycle {
  const customerName = [row.CUName, row.CULastName].filter(Boolean).join(" ").trim();
  return {
    id: row.MOIdMoto,
    brand: row.MOBrand,
    model: row.MOModel,
    plate: row.MOPlate,
    customer: row.CUIdCustomer === null
      ? null
      : { id: row.CUIdCustomer, name: customerName || "No registrado" },
  };
}

export async function getMaintenanceMotorcycles(
  page: number,
  pageSize: number,
  search: string,
): Promise<MaintenanceMotorcyclePage> {
  validatePagination(page, pageSize);
  const criterion = search.trim();
  const like = `%${criterion}%`;
  const where = criterion
    ? `WHERE MO.MOPlate LIKE ? OR MO.MOModel LIKE ? OR MO.MOBrand LIKE ?
       OR CONCAT_WS(' ', CU.CUName, CU.CULastName) LIKE ?`
    : "";
  const parameters = criterion ? [like, like, like, like] : [];
  const [countRows] = await pool.execute<CountRow[]>(`
    SELECT COUNT(*) AS total
    FROM MOTORCYCLES MO
    LEFT JOIN CUSTOMER CU ON CU.CUIdCustomer = MO.CUIdCustomer
    ${where}
  `, parameters);
  const total = countRows[0]?.total ?? 0;
  const [rows] = await pool.query<MotorcycleRow[]>(`
    SELECT MO.MOIdMoto, MO.MOBrand, MO.MOModel, MO.MOPlate,
           CU.CUIdCustomer, CU.CUName, CU.CULastName
    FROM MOTORCYCLES MO
    LEFT JOIN CUSTOMER CU ON CU.CUIdCustomer = MO.CUIdCustomer
    ${where}
    ORDER BY MO.MOIdMoto DESC
    LIMIT ? OFFSET ?
  `, [...parameters, pageSize, (page - 1) * pageSize]);
  return {
    motorcycles: rows.map(mapMotorcycle),
    pagination: { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) },
  };
}

export async function getMaintenanceMotorcycleById(
  motorcycleId: number,
): Promise<MaintenanceMotorcycle | null> {
  if (!Number.isSafeInteger(motorcycleId) || motorcycleId <= 0) throw new TypeError("Invalid motorcycle id");
  const [rows] = await pool.execute<MotorcycleRow[]>(`
    SELECT MO.MOIdMoto, MO.MOBrand, MO.MOModel, MO.MOPlate,
           CU.CUIdCustomer, CU.CUName, CU.CULastName
    FROM MOTORCYCLES MO
    LEFT JOIN CUSTOMER CU ON CU.CUIdCustomer = MO.CUIdCustomer
    WHERE MO.MOIdMoto = ?
    LIMIT 1
  `, [motorcycleId]);
  return rows[0] ? mapMotorcycle(rows[0]) : null;
}

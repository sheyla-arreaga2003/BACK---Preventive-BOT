import type { RowDataPacket } from "mysql2";
import pool from "../config/database.js";

export interface Page<T> { items: T[]; pagination: { page: number; pageSize: number; total: number; totalPages: number } }

function pagination(page: number, pageSize: number): void {
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 20) {
    throw new RangeError("Invalid pagination");
  }
}

function text(value: string): string {
  const result = value.trim();
  if (!result || result.length > 120) throw new TypeError("Invalid search text");
  return result;
}

function pageMeta(page: number, pageSize: number, total: number): Page<never>["pagination"] {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) };
}

interface CountRow extends RowDataPacket { total: number }

export async function getCustomerSummary(): Promise<{ total: number; active: number; inactive: number; newThisMonth: number }> {
  const [rows] = await pool.execute<Array<RowDataPacket & { total: number; active: number; inactive: number; newThisMonth: number }>>(`
    SELECT COUNT(*) total,
      SUM(CASE WHEN CUState = 1 THEN 1 ELSE 0 END) active,
      SUM(CASE WHEN CUState = 0 THEN 1 ELSE 0 END) inactive,
      SUM(CASE WHEN CUFregister >= DATE_FORMAT(CURRENT_DATE, '%Y-%m-01')
        AND CUFregister < DATE_ADD(DATE_FORMAT(CURRENT_DATE, '%Y-%m-01'), INTERVAL 1 MONTH) THEN 1 ELSE 0 END) newThisMonth
    FROM CUSTOMER
  `);
  const row = rows[0];
  return { total: Number(row?.total ?? 0), active: Number(row?.active ?? 0), inactive: Number(row?.inactive ?? 0), newThisMonth: Number(row?.newThisMonth ?? 0) };
}

export interface CustomerListItem { id: number; name: string; lastName: string; dpi: string; nit: string; phone: string; email: string; state: number | null; registeredAt: string | null }

export type CustomerDetailResult = { status: "not_found" } | { status: "ambiguous" } | { status: "found"; data: {
  customer: CustomerListItem & { address: string };
  motorcycles: Array<{ id: number; brand: string; model: string; year: string; color: string; plate: string | null; state: number | null }>;
} };

interface CustomerDetailRow extends RowDataPacket {
  CUIdCustomer: number; CUName: string; CULastName: string; CUDPI: string; CUNIT: string; CUPhone: string;
  CUMail: string; CUAddress: string; CUState: number | null; registeredAt: string | null;
}

async function customerDetail(row: CustomerDetailRow): Promise<CustomerDetailResult> {
  const [motorcycles] = await pool.execute<Array<RowDataPacket & { MOIdMoto: number; MOBrand: string; MOModel: string; MOYear: string; MOColor: string; MOPlate: string | null; MOState: number | null }>>(`
    SELECT MOIdMoto, MOBrand, MOModel, MOYear, MOColor, MOPlate, MOState FROM MOTORCYCLES WHERE CUIdCustomer = ? ORDER BY MOIdMoto DESC
  `, [row.CUIdCustomer]);
  return { status: "found", data: {
    customer: { id: row.CUIdCustomer, name: row.CUName, lastName: row.CULastName, dpi: row.CUDPI, nit: row.CUNIT, phone: row.CUPhone, email: row.CUMail, address: row.CUAddress, state: row.CUState, registeredAt: row.registeredAt },
    motorcycles: motorcycles.map((item) => ({ id: item.MOIdMoto, brand: item.MOBrand, model: item.MOModel, year: String(item.MOYear), color: item.MOColor, plate: item.MOPlate, state: item.MOState })),
  } };
}

export async function searchCustomers(query: string, page: number, pageSize: number): Promise<Page<CustomerListItem>> {
  pagination(page, pageSize);
  const pattern = `%${text(query)}%`;
  const where = `CONCAT(CUName, ' ', CULastName) LIKE ? OR CUDPI LIKE ? OR CUNIT LIKE ? OR CUPhone LIKE ? OR CUMail LIKE ?`;
  const parameters = [pattern, pattern, pattern, pattern, pattern];
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM CUSTOMER WHERE ${where}`, parameters);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & {
    CUIdCustomer: number; CUName: string; CULastName: string; CUDPI: string; CUNIT: string; CUPhone: string; CUMail: string; CUState: number | null; registeredAt: string | null;
  }>>(`SELECT CUIdCustomer, CUName, CULastName, CUDPI, CUNIT, CUPhone, CUMail, CUState,
    DATE_FORMAT(CUFregister, '%Y-%m-%d') registeredAt FROM CUSTOMER WHERE ${where}
    ORDER BY CUIdCustomer DESC LIMIT ? OFFSET ?`, [...parameters, pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ id: row.CUIdCustomer, name: row.CUName, lastName: row.CULastName, dpi: row.CUDPI, nit: row.CUNIT, phone: row.CUPhone, email: row.CUMail, state: row.CUState, registeredAt: row.registeredAt })), pagination: pageMeta(page, pageSize, total) };
}

export async function getCustomerDetailByNit(nit: string): Promise<CustomerDetailResult> {
  const value = text(nit);
  const [customers] = await pool.execute<CustomerDetailRow[]>(`SELECT CUIdCustomer, CUName, CULastName, CUDPI, CUNIT, CUPhone, CUMail, CUAddress, CUState,
    DATE_FORMAT(CUFregister, '%Y-%m-%d') registeredAt FROM CUSTOMER WHERE CUNIT = ? LIMIT 2`, [value]);
  const row = customers[0];
  if (!row) return { status: "not_found" };
  if (customers.length > 1) return { status: "ambiguous" };
  return customerDetail(row);
}

export async function getCustomerDetailById(customerId: number): Promise<CustomerDetailResult> {
  if (!Number.isInteger(customerId) || customerId < 1) throw new RangeError("Invalid customer identifier");
  const [customers] = await pool.execute<CustomerDetailRow[]>(`SELECT CUIdCustomer, CUName, CULastName, CUDPI, CUNIT, CUPhone, CUMail, CUAddress, CUState,
    DATE_FORMAT(CUFregister, '%Y-%m-%d') registeredAt FROM CUSTOMER WHERE CUIdCustomer = ? LIMIT 1`, [customerId]);
  const row = customers[0];
  return row ? customerDetail(row) : { status: "not_found" };
}

export async function getMotorcycleList(page: number, pageSize: number): Promise<Page<{ id: number; brand: string; model: string; year: string; color: string; plate: string | null; state: number | null }>> {
  pagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM MOTORCYCLES`);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & { MOIdMoto: number; MOBrand: string; MOModel: string; MOYear: string; MOColor: string; MOPlate: string | null; MOState: number | null }>>(`
    SELECT MOIdMoto, MOBrand, MOModel, MOYear, MOColor, MOPlate, MOState FROM MOTORCYCLES ORDER BY MOIdMoto DESC LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ id: row.MOIdMoto, brand: row.MOBrand, model: row.MOModel, year: String(row.MOYear), color: row.MOColor, plate: row.MOPlate, state: row.MOState })), pagination: pageMeta(page, pageSize, total) };
}

export async function getPlateHistory(motorcycleId: number): Promise<Array<{ state: string | null; firstDate: string; updatedDate: string }>> {
  const [rows] = await pool.execute<Array<RowDataPacket & { STState: string | null; PRFirstDate: string; PRDateUpdate: string }>>(`
    SELECT SP.STState, P.PRFirstDate, P.PRDateUpdate FROM PROCESSING P
    LEFT JOIN STATE_PLATE SP ON SP.STIdState = P.STIdState
    WHERE P.MOIdMoto = ? ORDER BY P.PRIdProcess DESC
  `, [motorcycleId]);
  return rows.map((row) => ({ state: row.STState, firstDate: row.PRFirstDate, updatedDate: row.PRDateUpdate }));
}

export async function getServiceCatalog(page: number, pageSize: number): Promise<Page<{ name: string; description: string; recommendedReading: string | null; recommendedTime: string | null; referencePrice: string | null; state: number | null; details: string | null }>> {
  pagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM SERVICES`);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & { SEName: string; SEDescription: string; SEMilesRecom: string | null; SETimeRecom: string | null; SEPriceRef: string | null; SEState: number | null; SEDetails: string | null }>>(`
    SELECT SEName, SEDescription, SEMilesRecom, SETimeRecom, SEPriceRef, SEState, SEDetails FROM SERVICES ORDER BY SEIdService LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ name: row.SEName, description: row.SEDescription, recommendedReading: row.SEMilesRecom, recommendedTime: row.SETimeRecom, referencePrice: row.SEPriceRef, state: row.SEState, details: row.SEDetails })), pagination: pageMeta(page, pageSize, total) };
}

export async function getSparePartsCatalog(page: number, pageSize: number): Promise<Page<{ name: string; brand: string; description: string }>> {
  pagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM SPARE_PARTS`);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & { SPNname: string; SPBrand: string; SPDescription: string }>>(`SELECT SPNname, SPBrand, SPDescription FROM SPARE_PARTS ORDER BY SPId LIMIT ? OFFSET ?`, [pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ name: row.SPNname, brand: row.SPBrand, description: row.SPDescription })), pagination: pageMeta(page, pageSize, total) };
}

export async function getUsersAndRoles(page: number, pageSize: number): Promise<Page<{ name: string; lastName: string; email: string; phone: string | null; role: string | null; registeredAt: string | null }>> {
  pagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM USERS`);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & { USName: string; USLastName: string; USEmail: string; USPhone: string | null; ROName: string | null; registeredAt: string | null }>>(`
    SELECT U.USName, U.USLastName, U.USEmail, U.USPhone, R.ROName, DATE_FORMAT(U.USFregister, '%Y-%m-%d') registeredAt
    FROM USERS U LEFT JOIN ROL R ON R.ROIdRol = U.ROIdRol ORDER BY U.USId LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ name: row.USName, lastName: row.USLastName, email: row.USEmail, phone: row.USPhone, role: row.ROName, registeredAt: row.registeredAt })), pagination: pageMeta(page, pageSize, total) };
}

export async function getReminderList(page: number, pageSize: number): Promise<Page<{ title: string; description: string; programmedDate: string; type: string; state: number | null; sentAt: string; motorcycle: string | null }>> {
  pagination(page, pageSize);
  const [counts] = await pool.execute<CountRow[]>(`SELECT COUNT(*) total FROM REMINDER`);
  const total = Number(counts[0]?.total ?? 0);
  const [rows] = await pool.query<Array<RowDataPacket & { RETitle: string; REDescription: string; REDateProgram: string; REType: string; REState: number | null; REFSend: string; motorcycle: string | null }>>(`
    SELECT R.RETitle, R.REDescription, R.REDateProgram, R.REType, R.REState, R.REFSend,
      CASE WHEN MO.MOIdMoto IS NULL THEN NULL ELSE CONCAT(MO.MOBrand, ' ', MO.MOModel) END motorcycle
    FROM REMINDER R LEFT JOIN MAINTENANCE MA ON MA.MAMaintenance = R.MAMaintenance
    LEFT JOIN MOTORCYCLES MO ON MO.MOIdMoto = MA.MOIdMoto
    ORDER BY R.REIdReminder DESC LIMIT ? OFFSET ?
  `, [pageSize, (page - 1) * pageSize]);
  return { items: rows.map((row) => ({ title: row.RETitle, description: row.REDescription, programmedDate: row.REDateProgram, type: row.REType, state: row.REState, sentAt: row.REFSend, motorcycle: row.motorcycle })), pagination: pageMeta(page, pageSize, total) };
}

import pool from "../config/database.js";
import { WITHOUT_REGISTERED_PLATE_SQL } from "./motorcycle-plate-status.service.js";
import type { ResultSetHeader, RowDataPacket } from "mysql2";

export interface UserRow extends RowDataPacket {
  USId: number;
  USName: string;
  USLastName: string;
  USEmail: string;
  USPhone: string | null;
  USPassword: string;
  ROIdRol: number | null;
}

export interface AuthenticatedUserRow extends RowDataPacket {
  USId: number;
  USName: string;
  USLastName: string;
  USEmail: string;
  USPhone: string | null;
  ROIdRol: number | null;
}

interface MotorcycleLatestProcessRow extends RowDataPacket {
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

export interface MotorcycleInvoiceProcessData {
  brand: string;
  model: string;
  year: string | number;
  color: string;
  plate: string | null;
  latestState: {
    id: number;
    name: string;
    registeredDate: string;
  } | null;
}

export type MotorcycleInvoiceProcessResult =
  | { status: "found"; data: MotorcycleInvoiceProcessData }
  | { status: "not_found" }
  | { status: "ambiguous" };

type MotorcycleInvoiceProcessQuery = (
  query: string,
  parameters: readonly [string, string],
) => Promise<MotorcycleLatestProcessRow[]>;

const motorcycleWithLatestProcessQuery = `
  SELECT
    MO.MOIdMoto,
    MO.MOBrand,
    MO.MOModel,
    MO.MOYear,
    MO.MOColor,
    MO.MOPlate,
    LP.STIdState,
    SP.STState,
    LP.PRFirstDate
  FROM MOTORCYCLES MO
  LEFT JOIN PROCESSING LP
    ON LP.PRIdProcess = (
      SELECT MAX(P.PRIdProcess)
      FROM PROCESSING P
      WHERE P.MOIdMoto = MO.MOIdMoto
    )
  LEFT JOIN STATE_PLATE SP
    ON SP.STIdState = LP.STIdState
  WHERE MO.MOSerieInvoice = ?
    AND MO.MONumberInvoice = ?
`;

const executeMotorcycleInvoiceProcessQuery: MotorcycleInvoiceProcessQuery = async (query, parameters) => {
  const [rows] = await pool.execute<MotorcycleLatestProcessRow[]>(query, [...parameters]);
  return rows;
};

export async function getMotorcycleWithLatestProcessByInvoice(
  serieInvoice: string,
  numberInvoice: string,
  executeQuery: MotorcycleInvoiceProcessQuery = executeMotorcycleInvoiceProcessQuery,
): Promise<MotorcycleInvoiceProcessResult> {
  if (typeof serieInvoice !== "string" || serieInvoice.trim().length === 0) {
    throw new TypeError("serieInvoice must be a non-empty string");
  }

  if (typeof numberInvoice !== "string" || numberInvoice.trim().length === 0) {
    throw new TypeError("numberInvoice must be a non-empty string");
  }

  const rows = await executeQuery(motorcycleWithLatestProcessQuery, [
    serieInvoice.trim(),
    numberInvoice.trim(),
  ]);

  if (rows.length === 0) return { status: "not_found" };
  if (rows.length > 1) return { status: "ambiguous" };

  const motorcycle = rows[0];
  if (!motorcycle) return { status: "not_found" };

  let latestState: MotorcycleInvoiceProcessData["latestState"] = null;
  if (
    motorcycle.STIdState !== null
    && motorcycle.STState !== null
    && motorcycle.PRFirstDate !== null
  ) {
    latestState = {
      id: motorcycle.STIdState,
      name: motorcycle.STState,
      registeredDate: motorcycle.PRFirstDate,
    };
  }

  return {
    status: "found",
    data: {
      brand: motorcycle.MOBrand,
      model: motorcycle.MOModel,
      year: motorcycle.MOYear,
      color: motorcycle.MOColor,
      plate: motorcycle.MOPlate,
      latestState,
    },
  };
}

export async function addMotorcycle (
  CUIdCustomer: string,
  MOPlate: string,
    MOBrand: string,
    MOModel: string,
    MOYear: string,
    MOColor: string,
    MOCilindraje: string,
    MOVin: string,
    MOMiles: string,
    MOChassis: string,
    MOSerieInvoice: string,
    MONumberInvoice: string
): Promise<ResultSetHeader> {
  const query = `INSERT INTO MOTORCYCLES
      (
        CUIdCustomer,
        MOPlate,
        MOBrand,
        MOModel,
        MOYear,
        MOColor,
        MOCilindraje,
        MOVin,
        MOMiles,
        MOChassis,
        MOSerieInvoice,
        MONumberInvoice
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [
    CUIdCustomer,
    MOPlate,
    MOBrand,
    MOModel,
    MOYear,
    MOColor,
    MOCilindraje,
    MOVin,
    MOMiles,
    MOChassis,
    MOSerieInvoice,
    MONumberInvoice,
  ]);
  return result;
}
    
export async function getClientByNit(nit: string): Promise<any> {
  const query = `SELECT * FROM CUSTOMER WHERE CUNIT = ?`;
  const [rows] = await pool.execute(query, [nit]);  
  return rows;
}

export async function getClients(page: number = 1,pageSize: number = 20): Promise<any> {
  const offset = (page - 1) * pageSize;

  const query = `SELECT * FROM CUSTOMER ORDER BY CUIdCustomer LIMIT ? OFFSET ?`;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM CUSTOMER
  `;

  const [rows] = await pool.query(query, [
    pageSize,
    offset
  ]);

  const [countRows]: any = await pool.execute(countQuery);

  const total = countRows[0].total;

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

export async function addProcess(idMotorcycle: number, idState: number, observations: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO PROCESSING (MOIdMoto, STIdState, PRObservations, PRFirstDate, PRDateUpdate) VALUES (?, ?, ?, CURDATE(), CURDATE())`;
  const [result] = await pool.execute<ResultSetHeader>(query, [idMotorcycle, idState, observations]);
  return result;
}

export async function getUserByEmail(email: string): Promise<UserRow[]> {
  const query = `SELECT * FROM USERS WHERE USEmail = ?`;
  const [rows] = await pool.execute<UserRow[]>(query, [email]);
  return rows;
}

export async function getAuthenticatedUserById(userId: number): Promise<AuthenticatedUserRow | null> {
  const query = `
    SELECT USId, USName, USLastName, USEmail, USPhone, ROIdRol
    FROM USERS
    WHERE USId = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute<AuthenticatedUserRow[]>(query, [userId]);
  return rows[0] ?? null;
}

export async function getMotorcyclesByCustomerId(customerId: number): Promise<any> {
  const query = `SELECT * FROM MOTORCYCLES WHERE CUIdCustomer = ?`;
  const [rows] = await pool.execute(query, [customerId]);
  return rows;
}
export async function getMotorcycleByPlate(plate: string): Promise<any> {
  const query = `SELECT MO.*, CU.CUName, CU.CULastName FROM MOTORCYCLES MO INNER JOIN CUSTOMER CU ON MO.CUIdCustomer = CU.CUIdCustomer WHERE MO.MOPlate = ?`;
  const [rows] = await pool.execute(query, [plate]);
  return rows;
}

export async function getMotorcyclePendingPlates(page: number = 1, pageSize: number = 20): Promise<any> {
  const offset = (page - 1) * pageSize;
  
  const countQuery = `SELECT COUNT(*) AS total FROM MOTORCYCLES WHERE ${WITHOUT_REGISTERED_PLATE_SQL}`;
  
  const [countRows]: any = await pool.execute(countQuery);

  const total = countRows[0].total;
  
  const query = `SELECT * FROM MOTORCYCLES WHERE ${WITHOUT_REGISTERED_PLATE_SQL} ORDER BY MOIdMoto LIMIT ? OFFSET ?`;
  
  const [rows] = await pool.query(query, [pageSize, offset]);

  return {
    data: rows,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  };
}

export async function getMotorcycleByInvoice(
  serieInvoice: string,
  numberInvoice: string
): Promise<any> {
  const query = `SELECT * FROM MOTORCYCLES WHERE MOSerieInvoice = ? AND MONumberInvoice = ?`;
  const [rows] = await pool.execute(query, [serieInvoice, numberInvoice]);
  return rows;
}

export async function updateUltimateLoginDate(userId: number): Promise<void> {
  const query = `UPDATE USERS SET USFregister = NOW() WHERE USId = ?`;
  await pool.execute(query, [userId]);
}

export async function addUser(name: string, roleId: number, lastname: string, email: string, phone: string, password: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO USERS (USName, ROIdRol, USLastName, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [name, roleId, lastname, email, phone, password]);
  return result;
}


export async function addClient(CUName: string, CULastName: string, CUDPI: string, CUPhone: string, CUMail: string, CUAddress: string, CUState: number, CUNIT: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO CUSTOMER (CUName, CULastname, CUDPI, CUPhone, CUmail, CUAddress, CUState, CUNIT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [CUName, CULastName, CUDPI, CUPhone, CUMail, CUAddress, CUState, CUNIT]);
  return result;
}

export async function patchClient(nit: string, CUName: string, CULastName: string, CUPhone: string, CUMail: string, CUAddress: string, CUState: number): Promise<void> {
  const query = `UPDATE CUSTOMER SET CUName = ?, CULastName = ?, CUPhone = ?, CUMail = ?, CUAddress = ?, CUState = ? WHERE CUNIT = ?`;
  await pool.execute(query, [CUName, CULastName, CUPhone, CUMail, CUAddress, CUState, nit]);
}

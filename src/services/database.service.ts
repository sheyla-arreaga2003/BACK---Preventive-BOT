import pool from "../config/database.js";
import type { ResultSetHeader } from "mysql2";

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

  const query = `SELECT * FROM CUSTOMER ORDER BY id LIMIT ? OFFSET ?`;

  const countQuery = `
    SELECT COUNT(*) AS total
    FROM CUSTOMER
  `;

  const [rows] = await pool.execute(query, [
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

export async function getUserByUsername(username: string): Promise<any> {
  const query = `SELECT * FROM USER WHERE USUsername = ?`;
  const [rows] = await pool.execute(query, [username]);
  return rows;
}

export async function getMotorcyclesByCustomerId(customerId: number): Promise<any> {
  const query = `SELECT * FROM MOTORCYCLES WHERE CUIdCustomer = ?`;
  const [rows] = await pool.execute(query, [customerId]);
  return rows;
}
export async function getMotorcycleByPlate(plate: string): Promise<any> {
  const query = `SELECT MO.*, CU.CUName, CU.CULastName FROM MOTORCYCLES MO INNER JOIN CUSTOMER CU ON MOTORCYCLES.CUIdCustomer = CUSTOMER.CUIdCustomer WHERE MOPlate = ?`;
  const [rows] = await pool.execute(query, [plate]);
  return rows;
}

export async function getMotorcyclePendingPlates(page: number = 1, pageSize: number = 20): Promise<any> {
  const offset = (page - 1) * pageSize;
  
  const countQuery = `SELECT COUNT(*) AS total FROM MOTORCYCLES WHERE MOPlate IS NULL`;
  
  const [countRows]: any = await pool.execute(countQuery);

  const total = countRows[0].total;
  
  const query = `SELECT * FROM MOTORCYCLES WHERE MOPlate IS NULL ORDER BY id LIMIT ? OFFSET ?`;
  
  const [rows] = await pool.execute(query, [pageSize, offset]);

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
  const query = `UPDATE USER SET USFregister = NOW() WHERE USIdUser = ?`;
  await pool.execute(query, [userId]);
}

export async function addUser(name: string, rol: string, lastname: string, email: string, phone: string, password: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO USER (USName, USRol, USLastname, USEmail, USPhone, USPassword) VALUES (?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [name, rol, lastname, email, phone, password]);
  return result;
}

export async function addClient(CUName: string, CULastName: string, CUDPI: string, CUPhone: string, CUMail: string, CUAddress: string, CUState: string, CUNIT: string): Promise<ResultSetHeader> {
  const query = `INSERT INTO CUSTOMER (CUName, CULastname, CUDPI, CUPhone, CUmail, CUAddress, CUState, CUNIT) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`;
  const [result] = await pool.execute<ResultSetHeader>(query, [CUName, CULastName, CUDPI, CUPhone, CUMail, CUAddress, CUState, CUNIT]);
  return result;
}

export async function patchClient(nit: string, CUName: string, CULastName: string, CUPhone: string, CUMail: string, CUAddress: string, CUState: string): Promise<void> {
  const query = `UPDATE CUSTOMER SET CUName = ?, CULastName = ?, CUPhone = ?, CUMail = ?, CUAddress = ?, CUState = ? WHERE CUNIT = ?`;
  await pool.execute(query, [CUName, CULastName, CUPhone, CUMail, CUAddress, CUState, nit]);
}